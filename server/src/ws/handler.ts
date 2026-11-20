import { PROTOCOL_VERSION } from "@secure-transfer/shared";
import { registerUser } from "../auth/register.js";
import { loginUser } from "../auth/login.js";
import {
  clearSession,
  getSession,
  setSession,
} from "../auth/session.js";
import { allowLoginAttempt } from "../auth/rate-limit.js";

import { listFiles } from "../files/list.js";

import {
  initializeUpload,
  cancelUpload,
  receiveUploadChunk,
  completeUpload,
} from "../files/upload.js";

import {
  initializeDownload,
  readDownloadChunk,
  closeDownload,
} from "../files/download.js";

import type {
  RequestEnvelope,
  ResponseEnvelope,
} from "@secure-transfer/shared";
import type { RawData, WebSocket } from "ws";

type ParseResult =
  | { ok: true; request: RequestEnvelope }
  | { ok: false; code: string; message: string };

/** 解析并校验 WebSocket 请求的协议封装。 */
function parseRequest(data: RawData, isBinary: boolean): ParseResult {
  if (isBinary) {
    return {
      ok: false,
      code: "INVALID_MESSAGE",
      message: "Expected a text message",
    };
  }

  let value: unknown;

  try {
    value = JSON.parse(data.toString());
  } catch {
    return {
      ok: false,
      code: "INVALID_JSON",
      message: "Invalid JSON message",
    };
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "Invalid request envelope",
    };
  }

  const record = value as Record<string, unknown>;

  if (
    record.version !== PROTOCOL_VERSION ||
    record.type !== "request" ||
    typeof record.id !== "string" ||
    record.id.trim().length === 0 ||
    record.id.length > 128 ||
    typeof record.action !== "string" ||
    record.action.length === 0 ||
    record.action.length > 64 ||
    !("payload" in record)
  ) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "Invalid request envelope",
    };
  }

  return {
    ok: true,
    request: value as RequestEnvelope,
  };
}

/** 将响应封装为 JSON 并发送给客户端。 */
function sendResponse(
  socket: WebSocket,
  response: ResponseEnvelope,
): void {
  socket.send(JSON.stringify(response));
}

/** 返回符合协议格式的错误响应。 */
function sendError(
  socket: WebSocket,
  id: string,
  code: string,
  message: string,
): void {
  sendResponse(socket, {
    version: PROTOCOL_VERSION,
    type: "response",
    id,
    ok: false,
    error: { code, message },
  });
}

/** 处理客户端发送的 WebSocket 消息。 */
export async function handleMessage(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean,
  clientIp: string,
): Promise<void> {
  if (isBinary) {
    const user = getSession(socket);

    if (!user) {
      sendError(
        socket,
        "unknown",
        "UNAUTHORIZED",
        "Authentication required",
      );
      return;
    }

    try {
      const buffer = Buffer.isBuffer(data)
        ? data
        : Buffer.concat(
            Array.isArray(data) ? data : [Buffer.from(data)],
          );

      const result = await receiveUploadChunk(socket, buffer);

      if (!result.ok) {
        sendError(socket, "unknown", result.code, result.message);
        return;
      }

      sendResponse(socket, {
        version: PROTOCOL_VERSION,
        type: "response",
        id: `chunk:${result.data.transferId}:${result.data.sequence}`,
        ok: true,
        payload: result.data,
      });
    } catch (error) {
      console.error("Upload chunk failed:", error);

      await cancelUpload(socket).catch(console.error);

      sendError(
        socket,
        "unknown",
        "INTERNAL_ERROR",
        "Failed to process upload chunk",
      );
    }

    return;
  }


  const result = parseRequest(data, isBinary);

  if (!result.ok) {
    sendError(socket, "unknown", result.code, result.message);
    return;
  }

  const request = result.request;

  switch (request.action) {
    case "system.ping":
      sendResponse(socket, {
        version: PROTOCOL_VERSION,
        type: "response",
        id: request.id,
        ok: true,
        payload: { message: "pong" },
      });
      break;
    
    case "auth.register": {
      try {
        const result = await registerUser(request.payload);

        if (!result.ok) {
          sendError(
            socket,
            request.id,
            result.code,
            result.message,
          );
          break;
        }

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: result.user,
        });
      } catch (error) {
        console.error("Registration failed:", error);

        sendError(
          socket,
          request.id,
          "INTERNAL_ERROR",
          "Internal server error",
        );
      }

      break;
    }

    case "auth.login": {
      try {
        if (!allowLoginAttempt(clientIp)) {
          sendError(
            socket,
            request.id,
            "RATE_LIMITED",
            "Too many login attempts. Please try again later.",
          );
          break;
        }

        const result = await loginUser(request.payload);

        if (!result.ok) {
          sendError(
            socket,
            request.id,
            result.code,
            result.message,
          );
          break;
        }

        setSession(socket, result.user);

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: result.user,
        });
      } catch (error) {
        console.error("Login failed:", error);

        sendError(
          socket,
          request.id,
          "INTERNAL_ERROR",
          "Internal server error",
        );
      }

      break;
    }

    case "auth.me": {
      const user = getSession(socket);

      if (!user) {
        sendError(
          socket,
          request.id,
          "UNAUTHORIZED",
          "Authentication required",
        );
        break;
      }

      sendResponse(socket, {
        version: PROTOCOL_VERSION,
        type: "response",
        id: request.id,
        ok: true,
        payload: user,
      });

      break;
    }

    case "auth.logout": {
      const user = getSession(socket);

      if (!user) {
        sendError(
          socket,
          request.id,
          "UNAUTHORIZED",
          "Authentication required",
        );
        break;
      }

      try {
        await cancelUpload(socket);
      } catch (error) {
        console.error("Failed to cancel upload on logout:", error);
      }

      await closeDownload(socket);
      clearSession(socket);

      sendResponse(socket, {
        version: PROTOCOL_VERSION,
        type: "response",
        id: request.id,
        ok: true,
        payload: {
          message: "Logged out",
        },
      });

      break;
    }    

    case "file.list": {
      const user = getSession(socket);

      if (!user) {
        sendError(
          socket,
          request.id,
          "UNAUTHORIZED",
          "Authentication required",
        );
        break;
      }

      try {
        const files = listFiles(user.id);

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: { files },
        });
      } catch (error) {
        console.error("Failed to list files:", error);

        sendError(
          socket,
          request.id,
          "INTERNAL_ERROR",
          "Internal server error",
        );
      }

      break;
    }


    case "file.upload.init": {
      const user = getSession(socket);

      if (!user) {
        sendError(
          socket,
          request.id,
          "UNAUTHORIZED",
          "Authentication required",
        );
        break;
      }

      try {
        const result = await initializeUpload(
          socket,
          user.id,
          request.payload,
        );

        if (!result.ok) {
          sendError(
            socket,
            request.id,
            result.code,
            result.message,
          );
          break;
        }

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: result.data,
        });
      } catch (error) {
        console.error("Upload initialization failed:", error);

        sendError(
          socket,
          request.id,
          "INTERNAL_ERROR",
          "Internal server error",
        );
      }

      break;
    }

    case "file.upload.cancel": {
      const user = getSession(socket);

      if (!user) {
        sendError(
          socket,
          request.id,
          "UNAUTHORIZED",
          "Authentication required",
        );
        break;
      }

      const payload = request.payload;

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("transferId" in payload) ||
        typeof payload.transferId !== "string"
      ) {
        sendError(
          socket,
          request.id,
          "INVALID_REQUEST",
          "Invalid transfer ID",
        );
        break;
      }

      try {
        const cancelled = await cancelUpload(
          socket,
          payload.transferId,
        );

        if (!cancelled) {
          sendError(
            socket,
            request.id,
            "TRANSFER_NOT_FOUND",
            "Upload not found",
          );
          break;
        }

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: { cancelled: true },
        });
      } catch (error) {
        console.error("Upload cancellation failed:", error);

        sendError(
          socket,
          request.id,
          "INTERNAL_ERROR",
          "Internal server error",
        );
      }

      break;
    }

    case "file.upload.complete": {
      const user = getSession(socket);

      if (!user) {
        sendError(
          socket,
          request.id,
          "UNAUTHORIZED",
          "Authentication required",
        );
        break;
      }

      const payload = request.payload;

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("transferId" in payload) ||
        typeof payload.transferId !== "string"
      ) {
        sendError(
          socket,
          request.id,
          "INVALID_REQUEST",
          "Invalid transfer ID",
        );
        break;
      }

      try {
        const result = await completeUpload(
          socket,
          payload.transferId,
        );

        if (!result.ok) {
          sendError(
            socket,
            request.id,
            result.code,
            result.message,
          );
          break;
        }

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: result.data,
        });
      } catch (error) {
        console.error("Upload completion failed:", error);

        sendError(
          socket,
          request.id,
          "INTERNAL_ERROR",
          "Internal server error",
        );
      }

      break;
    }

    case "file.download.init": {
      const user = getSession(socket);

      if (!user) {
        sendError(socket, request.id, "UNAUTHORIZED", "Authentication required");
        break;
      }

      const payload = request.payload;

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("fileId" in payload) ||
        typeof payload.fileId !== "string"
      ) {
        sendError(socket, request.id, "INVALID_REQUEST", "Invalid file ID");
        break;
      }

      try {
        const result = await initializeDownload(socket, user.id, payload.fileId);

        if (!result.ok) {
          sendError(socket, request.id, result.code, result.message);
          break;
        }

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: result.data,
        });
      } catch (error) {
        console.error("Download initialization failed:", error);
        sendError(socket, request.id, "INTERNAL_ERROR", "Internal server error");
      }

      break;
    }

    case "file.download.chunk": {
      if (!getSession(socket)) {
        sendError(socket, request.id, "UNAUTHORIZED", "Authentication required");
        break;
      }

      const payload = request.payload;

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("transferId" in payload) ||
        typeof payload.transferId !== "string" ||
        !("sequence" in payload) ||
        typeof payload.sequence !== "number"
      ) {
        sendError(socket, request.id, "INVALID_REQUEST", "Invalid chunk request");
        break;
      }

      try {
        const result = await readDownloadChunk(
          socket,
          payload.transferId,
          payload.sequence,
        );

        if (!result.ok) {
          sendError(socket, request.id, result.code, result.message);
          break;
        }

        const { transferId, sequence, chunk } = result.data;

        const frame = Buffer.allocUnsafe(40 + chunk.length);
        frame.write(transferId, 0, 36, "ascii");
        frame.writeUInt32BE(sequence, 36);
        chunk.copy(frame, 40);

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: { transferId, sequence, length: chunk.length },
        });

        socket.send(frame);
      } catch (error) {
        console.error("Download chunk failed:", error);
        await closeDownload(socket).catch(console.error);
        sendError(socket, request.id, "INTERNAL_ERROR", "Internal server error");
      }

      break;
    }

    case "file.download.complete": {
      if (!getSession(socket)) {
        sendError(socket, request.id, "UNAUTHORIZED", "Authentication required");
        break;
      }

      const payload = request.payload;

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("transferId" in payload) ||
        typeof payload.transferId !== "string"
      ) {
        sendError(socket, request.id, "INVALID_REQUEST", "Invalid transfer ID");
        break;
      }

      try {
        const closed = await closeDownload(socket, payload.transferId);

        if (!closed) {
          sendError(socket, request.id, "TRANSFER_NOT_FOUND", "Download not found");
          break;
        }

        sendResponse(socket, {
          version: PROTOCOL_VERSION,
          type: "response",
          id: request.id,
          ok: true,
          payload: { completed: true },
        });
      } catch (error) {
        console.error("Download completion failed:", error);
        sendError(socket, request.id, "INTERNAL_ERROR", "Internal server error");
      }

      break;
    }

    default:
      sendError(
        socket,
        request.id,
        "UNKNOWN_ACTION",
        "Unsupported action",
      );
  }
}