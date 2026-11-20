import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { WebSocket, WebSocketServer } from "ws";
import { initializeDatabase } from "./db.js";
import { clearSession } from "./auth/session.js";
import { handleMessage } from "./ws/handler.js";
import {
  cancelUpload,
  cleanupExpiredUpload,
} from "./files/upload.js";
import {
  closeDownload,
  cleanupExpiredDownload,
} from "./files/download.js";

import { PROTOCOL_VERSION } from "@secure-transfer/shared";
import type {
  HealthPayload,
  ResponseEnvelope,
} from "@secure-transfer/shared";

const port = Number(process.env.PORT ?? 3000);

const tlsOptions = {
  key: readFileSync(
    new URL("../../certs/localhost-key.pem", import.meta.url),
  ),
  cert: readFileSync(
    new URL("../../certs/localhost.pem", import.meta.url),
  ),
};

// HTTP API 服务，统一处理请求并返回结构化响应。
const server = createServer(tlsOptions, (request, response) => {
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
const allowedOrigins = new Set([
  "https://localhost:5173",
  "https://127.0.0.1:5173",
]);

const MAX_CONNECTIONS_PER_IP = 5;
const MAX_HANDSHAKES_PER_MINUTE = 10;
const HANDSHAKE_WINDOW_MS = 60_000;

const MAX_CONTROL_MESSAGES_PER_SECOND = 30;
const MAX_TRANSFER_MESSAGES_PER_SECOND = 256;
const MAX_PENDING_MESSAGES = 64;

type HandshakeState = {
  count: number;
  windowStart: number;
};

type MessageRateState = {
  control: number;
  transfer: number;
  windowStart: number;
};

const activeConnections = new Map<string, number>();
const pendingConnections = new Map<string, number>();
const handshakeAttempts = new Map<string, HandshakeState>();

function allowHandshake(clientIp: string): boolean {
  const now = Date.now();
  const state = handshakeAttempts.get(clientIp);

  if (!state || now - state.windowStart >= HANDSHAKE_WINDOW_MS) {
    handshakeAttempts.set(clientIp, {
      count: 1,
      windowStart: now,
    });
    return true;
  }

  if (state.count >= MAX_HANDSHAKES_PER_MINUTE) {
    return false;
  }

  state.count += 1;
  return true;
}

function decrementCount(
  counts: Map<string, number>,
  clientIp: string,
): void {
  const remaining = (counts.get(clientIp) ?? 0) - 1;

  if (remaining <= 0) {
    counts.delete(clientIp);
  } else {
    counts.set(clientIp, remaining);
  }
}

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 64 * 1024,
  verifyClient: (info, done) => {
    if (!info.origin || !allowedOrigins.has(info.origin)) {
      done(false, 403, "Forbidden");
      return;
    }

    const clientIp = info.req.socket.remoteAddress ?? "unknown";

    if (!allowHandshake(clientIp)) {
      done(false, 429, "Too Many Requests");
      return;
    }

    const connections =
      (activeConnections.get(clientIp) ?? 0) +
      (pendingConnections.get(clientIp) ?? 0);

    if (connections >= MAX_CONNECTIONS_PER_IP) {
      done(false, 429, "Too Many Connections");
      return;
    }

    // 为正在升级的连接预留名额。
    pendingConnections.set(
      clientIp,
      (pendingConnections.get(clientIp) ?? 0) + 1,
    );

    // 当前 ws 的同步 verifyClient 回调结束后，
    // connection 事件会同步完成连接计数转换。
    done(true);
  },
});

// 定期清理过期的握手记录，防止 Map 无限增长。
const handshakeCleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [ip, state] of handshakeAttempts) {
    if (now - state.windowStart >= HANDSHAKE_WINDOW_MS) {
      handshakeAttempts.delete(ip);
    }
  }
}, HANDSHAKE_WINDOW_MS);

handshakeCleanupTimer.unref();

// 记录每个 WebSocket 连接的心跳状态。
const alive = new WeakMap<WebSocket, boolean>();

/** 注册 WebSocket 连接及事件处理。 */
wss.on("connection", (socket, request) => {
  const clientIp = request.socket.remoteAddress ?? "unknown";

  decrementCount(pendingConnections, clientIp);

  activeConnections.set(
    clientIp,
    (activeConnections.get(clientIp) ?? 0) + 1,
  );

  const messageRate: MessageRateState = {
    control: 0,
    transfer: 0,
    windowStart: Date.now(),
  };

  let pendingMessages = 0;
  let rateLimitExceeded = false;

  function rejectConnection(reason: string): void {
    if (rateLimitExceeded) return;

    rateLimitExceeded = true;
    socket.close(1008, reason);
  }

  console.log("WebSocket client connected");

  // 新连接初始视为存活。
  alive.set(socket, true);

  let messageQueue = Promise.resolve();

  const uploadTimer = setInterval(() => {
    messageQueue = messageQueue
      .then(async () => {
        await cleanupExpiredUpload(socket);
        await cleanupExpiredDownload(socket);
      })
      .catch((error) => {
        console.error("Upload timeout cleanup failed:", error);
      });
  }, 30_000);

  // 收到 Pong 后更新连接状态。
  socket.on("pong", () => {
    alive.set(socket, true);
    // console.log("Heartbeat: Pong received"); // 测试心跳
    // console.log("Heartbeat: Pong ignored (test)"); // 测试不跳
  });

  socket.on("message", (data, isBinary) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const now = Date.now();

    if (now - messageRate.windowStart >= 1_000) {
      messageRate.control = 0;
      messageRate.transfer = 0;
      messageRate.windowStart = now;
    }

    let isTransfer = isBinary;

    if (!isBinary) {
      try {
        const message = JSON.parse(data.toString());

        isTransfer =
          message !== null &&
          typeof message === "object" &&
          message.version === PROTOCOL_VERSION &&
          message.type === "request" &&
          message.action === "file.download.chunk";
      } catch {
        isTransfer = false;
      }
    }

    if (isTransfer) {
      messageRate.transfer += 1;

      if (
        messageRate.transfer > MAX_TRANSFER_MESSAGES_PER_SECOND
      ) {
        rejectConnection( "Transfer rate limit exceeded");
        return;
      }
    } else {
      messageRate.control += 1;

      if (
        messageRate.control > MAX_CONTROL_MESSAGES_PER_SECOND
      ) {
        rejectConnection("Control rate limit exceeded");
        return;
      }
    }

    if (pendingMessages >= MAX_PENDING_MESSAGES) {
      rejectConnection("Message queue limit exceeded");
      return;
    }

    pendingMessages += 1;

    messageQueue = messageQueue
      .then(async () => {
        if (rateLimitExceeded || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        await handleMessage(socket, data, isBinary, clientIp);
      })
      .catch((error) => {
        console.error("WebSocket message handling failed:", error);
      })
      .finally(() => {
        pendingMessages -= 1;
      });
  });

  socket.on("close", () => {
    clearInterval(uploadTimer);
    decrementCount(activeConnections, clientIp);

    alive.delete(socket);
    clearSession(socket);

    void messageQueue
      .finally(async () => {
        await cancelUpload(socket);
        await closeDownload(socket);
      })
      .catch((error) => {
        console.error("Failed to clean up transfers:", error);
      });

    console.log("WebSocket client disconnected");
  });

  socket.on("error", (error) => {
    console.error("WebSocket connection error:", error);
  });
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
  clearInterval(handshakeCleanupTimer);
});

initializeDatabase();

// 监听本机回环地址和指定端口。
server.listen(port, "127.0.0.1", () => {
  console.log(`SecureTransfer API listening at https://127.0.0.1:${port}`);
});
