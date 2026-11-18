import {
  PROTOCOL_VERSION,
  FILE_CHUNK_SIZE,
  MAX_FILE_SIZE,
} from "@secure-transfer/shared";

import type {
  FileMetadata,
  FileUploadInitResult,
  FileUploadCompleteResult,
  FileListResult,
} from "@secure-transfer/shared";

import type { RequestEnvelope } from "@secure-transfer/shared";

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 管理 WebSocket 连接及请求与响应的匹配。 */
export class SecureTransferClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private uploading = false;

  onClose: (() => void) | null = null;

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 10000,
  ) {}

  /** 建立 WebSocket 连接。 */
  connect(): Promise<void> {
    if (this.socket !== null) {
      return Promise.reject(new Error("Connection already exists"));
    }

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }

      this.rejectPending(new Error("Connection closed"));
      this.onClose?.();
    });

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open",handleOpen);
        socket.removeEventListener("error",handleError);
        socket.removeEventListener("close",handleEarlyClose);
      };

      const handleOpen = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("WebSocket connection failed"));
      };

      const handleEarlyClose = () => {
        cleanup();
        reject(new Error("WebSocket closed before connecting"));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleEarlyClose);
    });
  }

  /** 发送协议请求并等待对应响应。 */
  request(action: string, payload: unknown): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }

    const request: RequestEnvelope = {
      version: PROTOCOL_VERSION,
      type: "request",
      id: crypto.randomUUID(),
      action,
      payload,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Request timed out: ${action}`));
      }, this.timeoutMs);

      this.pending.set(request.id, { resolve, reject, timer });

      try {
        this.socket!.send(JSON.stringify(request));
      } catch {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(new Error("Failed to send request"));
      }
    });
  }

  /** 根据响应 ID 找到对应的请求。 */
  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;

    let value: unknown;

    try {
      value = JSON.parse(data);
    } catch {
      return;
    }

    if (typeof value !== "object" || value === null) return;

    const response = value as Record<string, unknown>;

    if (
      response.version !== PROTOCOL_VERSION ||
      response.type !== "response" ||
      typeof response.id !== "string" ||
      typeof response.ok !== "boolean"
    ) {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      const error = response.error;

      if (typeof error === "object" && error !== null) {
        const detail = error as Record<string, unknown>;
        const message =
          typeof detail.message === "string"
            ? detail.message
            : "Request failed";

        pending.reject(new Error(message));
      } else {
        pending.reject(new Error("Request failed"));
      }
    }
  }

  /** 使所有等待中的请求失败。 */
  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }

    this.pending.clear();
  }

  /** 等待服务器确认一个文件块。 */
  private sendChunk(
    transferId: string,
    sequence: number,
    content: Uint8Array,
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }

    const socket = this.socket;
    const id = `chunk:${transferId}:${sequence}`;

    const frame = new Uint8Array(40 + content.byteLength);
    const header = new TextEncoder().encode(transferId);

    frame.set(header, 0);
    new DataView(frame.buffer).setUint32(36, sequence, false);
    frame.set(content, 40);

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Upload chunk timed out"));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (payload) => {
          if (
            typeof payload !== "object" ||
            payload === null ||
            !("sequence" in payload) ||
            payload.sequence !== sequence
          ) {
            reject(new Error("Invalid upload acknowledgment"));
            return;
          }

          resolve();
        },
        reject,
        timer,
      });

      try {
        socket.send(frame);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Failed to send upload chunk"));
      }
    });
  }

  /** 上传文件，按确认的分块数量报告进度。 */
  async uploadFile(
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<FileMetadata> {
    if (this.uploading) {
      throw new Error("An upload is already in progress");
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error("File exceeds 100 MiB limit");
    }

    this.uploading = true;
    let transferId: string | null = null;

    try {
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);

      const sha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      const init = await this.request("file.upload.init", {
        name: file.name,
        size: file.size,
        sha256,
      }) as FileUploadInitResult;

      if (
        !init ||
        typeof init.transferId !== "string" ||
        init.chunkSize !== FILE_CHUNK_SIZE
      ) {
        throw new Error("Invalid upload initialization response");
      }

      transferId = init.transferId;
      const bytes = new Uint8Array(buffer);

      for (
        let offset = 0, sequence = 0;
        offset < bytes.length;
        offset += FILE_CHUNK_SIZE, sequence++
      ) {
        const chunk = bytes.subarray(
          offset,
          Math.min(offset + FILE_CHUNK_SIZE, bytes.length),
        );

        await this.sendChunk(transferId, sequence, chunk);

        onProgress?.(
          Math.round(
            ((offset + chunk.byteLength) / bytes.length) * 100,
          ),
        );
      }

      const result = await this.request("file.upload.complete", {
        transferId,
      }) as FileUploadCompleteResult;

      if (!result?.file || typeof result.file.id !== "string") {
        throw new Error("Invalid upload completion response");
      }

      onProgress?.(100);
      return result.file;
    } catch (error) {
      if (transferId && this.socket?.readyState === WebSocket.OPEN) {
        await this.request("file.upload.cancel", {
          transferId,
        }).catch(() => {});
      }

      throw error;
    } finally {
      this.uploading = false;
    }
  }

  /** 获取当前登录用户的文件列表。 */
  async listFiles(): Promise<FileMetadata[]> {
    const result = await this.request(
      "file.list",
      {},
    ) as FileListResult;

    if (!result || !Array.isArray(result.files)) {
      throw new Error("Invalid file list response");
    }

    return result.files;
  }

  /** 关闭连接并清理等待中的请求。 */
  close(): void {
    this.rejectPending(new Error("Client closed"));
    this.socket?.close();
    this.socket = null;
  }
}