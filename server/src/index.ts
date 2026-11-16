import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { initializeDatabase } from "./db.js";
import { clearSession } from "./auth/session.js";

import { PROTOCOL_VERSION } from "@secure-transfer/shared";
import type {
  HealthPayload,
  ResponseEnvelope,
} from "@secure-transfer/shared";

import { handleMessage } from "./ws/handler.js";

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

// 记录每个 WebSocket 连接的心跳状态。
const alive = new WeakMap<WebSocket, boolean>();

/** 注册 WebSocket 连接及事件处理。 */
wss.on("connection", (socket, request) => {
  const clientIp = request.socket.remoteAddress ?? "unknown";

  console.log("WebSocket client connected");

  // 新连接初始视为存活。
  alive.set(socket, true);

  // 收到 Pong 后更新连接状态。
  socket.on("pong", () => {
    alive.set(socket, true);
    // console.log("Heartbeat: Pong received"); // 测试心跳
    // console.log("Heartbeat: Pong ignored (test)"); // 测试不跳
  });

  socket.on("message", (data, isBinary) => {
    void handleMessage(socket, data, isBinary, clientIp).catch((error) => {
      console.error("WebSocket message handling failed:", error);
    });
  });

  socket.on("close", () => {
    alive.delete(socket);
    clearSession(socket);
    console.log("WebSocket client disconnected");
  });

  socket.on("error", (error) => {
    console.error("WebSocket connection error:", error);
  });

  // TODO: 实现用户认证及请求权限检查。
  // TODO: 增加连接数与消息频率限制。
});

/** 定期检测连接存活状态并清理失效连接。 */
const heartbeatTimer = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }

    // 上一轮心跳未收到 Pong，终止连接。
    if (!alive.get(socket)) {
      socket.terminate();
      continue;
    }

    // 标记为等待响应，并发送 Ping。
    alive.set(socket, false);
    socket.ping();
  }
}, 30_000);

// WebSocket 服务关闭时清理定时器。
wss.on("close", () => {
  clearInterval(heartbeatTimer);
});

initializeDatabase();

// 监听本机回环地址和指定端口。
server.listen(port, "127.0.0.1", () => {
  console.log(`SecureTransfer API listening at http://127.0.0.1:${port}`);
});
