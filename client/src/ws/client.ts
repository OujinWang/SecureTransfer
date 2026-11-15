import { PROTOCOL_VERSION } from "@secure-transfer/shared";
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

  /** 关闭连接并清理等待中的请求。 */
  close(): void {
    this.rejectPending(new Error("Client closed"));
    this.socket?.close();
    this.socket = null;
  }
}