import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import {
  HealthPayload,
  PROTOCOL_VERSION,
  ResponseEnvelope,
} from "@secure-transfer/shared";

const port = Number(process.env.PORT ?? 3000);

// HTTP API 服务，统一处理请求并返回结构化响应。
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method === "GET" && request.url === "/api/health") {
    const result: ResponseEnvelope<HealthPayload> = {
      version: PROTOCOL_VERSION,
      type: "response",
      id: "health",
      ok: true,
      payload: { status: "ok", service: "secure-transfer-server" },
    };
    response.writeHead(200).end(JSON.stringify(result));
    return;
  }

  const result: ResponseEnvelope = {
    version: PROTOCOL_VERSION,
    type: "response",
    id: "unknown",
    ok: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  };
  response.writeHead(404).end(JSON.stringify(result));
});

/**
 * WebSocket 服务配置。
 * 与 HTTP API 共享监听端口，使用 /ws 作为连接入口。
 * 单条消息大小上限为 64 KiB。
 */
const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 64 * 1024,
});

/** 处理 WebSocket 连接及应用层协议消息。 */
wss.on("connection", (socket) => {
  console.log("WebSocket client connected");

  // 统一返回协议错误响应。
  const sendError = (id: string, code: string, message: string) => {
    const response: ResponseEnvelope = {
      version: PROTOCOL_VERSION,
      type: "response",
      id,
      ok: false,
      error: { code, message },
    };

    socket.send(JSON.stringify(response));
  };

  socket.on("message", (data, isBinary) => {
    // 控制协议使用 JSON 文本消息。
    if (isBinary) {
      sendError("unknown", "INVALID_MESSAGE", "Expected a text message");
      return;
    }

    let message: unknown;

    try {
      message = JSON.parse(data.toString());
    } catch {
      sendError("unknown", "INVALID_JSON", "Invalid JSON message");
      return;
    }

    // 校验请求封装的基本结构。
    if (
      typeof message !== "object" ||
      message === null ||
      !("version" in message) ||
      message.version !== PROTOCOL_VERSION ||
      !("type" in message) ||
      message.type !== "request" ||
      !("id" in message) ||
      typeof message.id !== "string" ||
      message.id.length === 0 ||
      message.id.length > 128 ||
      !("action" in message) ||
      typeof message.action !== "string" ||
      !("payload" in message)
    ) {
      sendError("unknown", "INVALID_REQUEST", "Invalid request envelope");
      return;
    }

    // 根据 action 分发请求。
    if (message.action === "system.ping") {
      const response: ResponseEnvelope<{ message: string }> = {
        version: PROTOCOL_VERSION,
        type: "response",
        id: message.id,
        ok: true,
        payload: { message: "pong" },
      };

      socket.send(JSON.stringify(response));
      return;
    }

    sendError(message.id, "UNKNOWN_ACTION", "Unsupported action");
  });

  socket.on("close", () => {
    console.log("WebSocket client disconnected");
  });

  // TODO: 实现周期性心跳检测和连接超时处理。
  // TODO: 实现连接身份认证及请求权限检查。
  // TODO: 增加消息频率和连接数量限制。
});

// 监听本机回环地址和指定端口。
server.listen(port, "127.0.0.1", () => {
  console.log(`SecureTransfer API listening at http://127.0.0.1:${port}`);
});
