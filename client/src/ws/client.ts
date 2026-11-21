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
  FileDownloadInitResult,
  SharedFileMetadata,
  GrantedFileShare,
} from "@secure-transfer/shared";

import type { RequestEnvelope } from "@secure-transfer/shared";

const SESSION_TOKEN_KEY = "secure-transfer.session-token";

interface PendingRequest {
  action: string;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingDownloadChunk {
  transferId: string;
  sequence: number;
  resolve: (chunk: ArrayBuffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 管理 WebSocket 连接及请求与响应的匹配。 */
export class SecureTransferClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private uploading = false;
  private downloading = false;
  private pendingDownload: PendingDownloadChunk | null = null;

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
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });

    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }

      this.rejectPending(new Error("Connection closed"));
      this.rejectDownload(new Error("Connection closed"));
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

      this.pending.set(request.id, { action, resolve, reject, timer });

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
    if (data instanceof ArrayBuffer) {
      const pending = this.pendingDownload;

      if (!pending) return;

      if (data.byteLength < 40) {
        this.rejectDownload(new Error("Invalid download frame"));
        return;
      }

      const transferId = new TextDecoder().decode(
        new Uint8Array(data, 0, 36),
      );
      const sequence = new DataView(data).getUint32(36, false);

      if (
        transferId !== pending.transferId ||
        sequence !== pending.sequence
      ) {
        this.rejectDownload(new Error("Unexpected download chunk"));
        return;
      }

      clearTimeout(pending.timer);
      this.pendingDownload = null;
      pending.resolve(data.slice(40));
      return;
    }

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
      if (pending.action === "auth.login") {
        const payload = response.payload;

        if (
          typeof payload !== "object" ||
          payload === null ||
          !("sessionToken" in payload) ||
          typeof payload.sessionToken !== "string" ||
          !/^[a-f0-9]{64}$/.test(payload.sessionToken)
        ) {
          pending.reject(new Error("Invalid login response"));
          return;
        }

        sessionStorage.setItem(
          SESSION_TOKEN_KEY,
          payload.sessionToken,
        );
      }

      if (pending.action === "auth.logout") {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }

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
        action: "file.upload.chunk",
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

  /** 删除当前用户拥有的文件。 */
  async deleteFile(fileId: string): Promise<void> {
    const result = await this.request("file.delete", {
      fileId,
    });

    if (
      typeof result !== "object" ||
      result === null ||
      !("deleted" in result) ||
      result.deleted !== true
    ) {
      throw new Error("File deletion failed");
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

  /** 将自己的文件共享给指定用户。 */
  async grantFileShare(
    fileId: string,
    recipientUsername: string,
  ): Promise<string> {
    const result = await this.request("file.share.grant", {
      fileId,
      recipientUsername,
    });

    if (
      typeof result !== "object" ||
      result === null ||
      !("recipientUsername" in result) ||
      typeof result.recipientUsername !== "string"
    ) {
      throw new Error("Invalid share response");
    }

    return result.recipientUsername;
  }

  /** 撤销指定用户的文件访问权限。 */
  async revokeFileShare(
    fileId: string,
    recipientUsername: string,
  ): Promise<void> {
    const result = await this.request("file.share.revoke", {
      fileId,
      recipientUsername,
    });

    if (
      typeof result !== "object" ||
      result === null ||
      !("revoked" in result) ||
      result.revoked !== true
    ) {
      throw new Error("Share not found or already revoked");
    }
  }

  /** 获取其他用户共享给自己的文件。 */
  async listReceivedShares(): Promise<SharedFileMetadata[]> {
    const result = await this.request("file.share.received", {});

    if (
      typeof result !== "object" ||
      result === null ||
      !("files" in result) ||
      !Array.isArray(result.files)
    ) {
      throw new Error("Invalid received shares response");
    }

    return result.files as SharedFileMetadata[];
  }

  /** 获取自己已经授予的文件共享权限。 */
  async listGrantedShares(): Promise<GrantedFileShare[]> {
    const result = await this.request("file.share.granted", {});

    if (
      typeof result !== "object" ||
      result === null ||
      !("shares" in result) ||
      !Array.isArray(result.shares)
    ) {
      throw new Error("Invalid granted shares response");
    }

    return result.shares as GrantedFileShare[];
  }

  /** 终止正在等待的下载分块。 */
  private rejectDownload(error: Error): void {
    const pending = this.pendingDownload;

    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingDownload = null;
    pending.reject(error);
  }

  /** 等待指定的二进制文件块。 */
  private waitForDownloadChunk(
    transferId: string,
    sequence: number,
  ): Promise<ArrayBuffer> {
    if (this.pendingDownload) {
      return Promise.reject(new Error("Another download chunk is pending"));
    }

    return new Promise<ArrayBuffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectDownload(new Error("Download chunk timed out"));
      }, this.timeoutMs);

      this.pendingDownload = {
        transferId,
        sequence,
        resolve,
        reject,
        timer,
      };
    });
  }

  /** 分块下载文件、验证 SHA-256 并保存到本地。 */
  async downloadFile(
    fileId: string,
    onProgress?: (percent: number) => void,
  ): Promise<void> {
    if (this.downloading) {
      throw new Error("A download is already in progress");
    }

    this.downloading = true;
    let transferId: string | null = null;

    try {
      const init = await this.request("file.download.init", {
        fileId,
      }) as FileDownloadInitResult;

      if (
        !init ||
        typeof init.transferId !== "string" ||
        init.chunkSize !== FILE_CHUNK_SIZE ||
        !init.file ||
        init.file.id !== fileId ||
        !Number.isSafeInteger(init.file.size) ||
        init.file.size < 0 ||
        init.file.size > MAX_FILE_SIZE ||
        typeof init.file.originalName !== "string" ||
        typeof init.file.sha256 !== "string" ||
        !/^[a-fA-F0-9]{64}$/.test(init.file.sha256)
      ) {
        throw new Error("Invalid download initialization response");
      }

      transferId = init.transferId;

      const chunks: ArrayBuffer[] = [];
      let received = 0;
      let sequence = 0;

      while (received < init.file.size) {
        const chunkPromise = this.waitForDownloadChunk(
          transferId,
          sequence,
        );

        const [ack, chunk] = await Promise.all([
          this.request("file.download.chunk", {
            transferId,
            sequence,
          }),
          chunkPromise,
        ]);

        if (
          typeof ack !== "object" ||
          ack === null ||
          !("sequence" in ack) ||
          ack.sequence !== sequence ||
          !("length" in ack) ||
          ack.length !== chunk.byteLength ||
          chunk.byteLength === 0 ||
          chunk.byteLength > FILE_CHUNK_SIZE ||
          received + chunk.byteLength > init.file.size
        ) {
          throw new Error("Invalid download chunk");
        }

        chunks.push(chunk);
        received += chunk.byteLength;
        sequence++;

        onProgress?.(
          Math.round((received / init.file.size) * 100),
        );
      }

      const blob = new Blob(chunks, {
        type: "application/octet-stream",
      });

      const digest = await crypto.subtle.digest(
        "SHA-256",
        await blob.arrayBuffer(),
      );

      const sha256 = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      if (sha256 !== init.file.sha256.toLowerCase()) {
        throw new Error("Downloaded file SHA-256 mismatch");
      }

      await this.request("file.download.complete", {
        transferId,
      });

      transferId = null;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = init.file.originalName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

      onProgress?.(100);
    } finally {
      this.rejectDownload(new Error("Download ended"));

      if (
        transferId &&
        this.socket?.readyState === WebSocket.OPEN
      ) {
        await this.request("file.download.complete", {
          transferId,
        }).catch(() => {});
      }

      this.downloading = false;
    }
  }


  /** 刷新页面后尝试恢复登录身份。 */
  async restoreSession(): Promise<{
    id: string;
    username: string;
    isVip: boolean;
  } | null> {
    const token = sessionStorage.getItem(SESSION_TOKEN_KEY);

    if (!token) {
      return null;
    }

    try {
      const result = await this.request("auth.restore", {
        token,
      });

      if (
        typeof result !== "object" ||
        result === null ||
        !("id" in result) ||
        typeof result.id !== "string" ||
        !("username" in result) ||
        typeof result.username !== "string" ||
        !("isVip" in result) ||
          typeof result.isVip !== "boolean"
      ) {
        throw new Error("Invalid session response");
      }

      return {
        id: result.id,
        username: result.username,
        isVip: result.isVip,
      };
    } catch {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      return null;
    }
  }

  /** 关闭连接并清理等待中的请求。 */
  close(): void {
    this.rejectPending(new Error("Client closed"));
    this.rejectDownload(new Error("Client closed"));
    this.socket?.close();
    this.socket = null;
  }
}