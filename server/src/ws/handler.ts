import { PROTOCOL_VERSION } from "@secure-transfer/shared";
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
export function handleMessage(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean,
): void {
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

    default:
      sendError(
        socket,
        request.id,
        "UNKNOWN_ACTION",
        "Unsupported action",
      );
  }
}