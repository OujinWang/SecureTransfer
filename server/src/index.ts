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

// 为每个 WebSocket 连接注册消息接收与连接关闭事件。
wss.on("connection", (socket) => {
  // TODO: 为连接建立心跳检测与超时机制。

  console.log("WebSocket client connected");

  socket.on("message", (data) => {
    console.log("Received:", data.toString());
  });

  socket.on("close", () => {
    console.log("WebSocket client disconnected");
  });
});

// 监听本机回环地址和指定端口。
server.listen(port, "127.0.0.1", () => {
  console.log(`SecureTransfer API listening at http://127.0.0.1:${port}`);
});
