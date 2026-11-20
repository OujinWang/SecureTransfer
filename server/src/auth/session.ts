
import { createHash, randomBytes } from "node:crypto";
import type WebSocket from "ws";

export interface AuthenticatedUser {
  id: string;
  username: string;
}

interface SessionRecord {
  user: AuthenticatedUser;
  expiresAt: number;
}

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

// 服务器只保存令牌哈希，不保存原始令牌。
const tokens = new Map<string, SessionRecord>();

// 每条 WebSocket 连接关联一个令牌哈希。
const sessions = new WeakMap<WebSocket, string>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 登录成功后签发新的会话令牌。 */
export function createSession(
  socket: WebSocket,
  user: AuthenticatedUser,
): string {
  revokeSession(socket);

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  tokens.set(tokenHash, {
    user,
    expiresAt: Date.now() + SESSION_DURATION_MS,
  });

  sessions.set(socket, tokenHash);

  return token;
}

/** 使用有效令牌恢复 WebSocket 登录身份。 */
export function restoreSession(
  socket: WebSocket,
  token: string,
): AuthenticatedUser | undefined {
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return undefined;
  }

  const tokenHash = hashToken(token);
  const record = tokens.get(tokenHash);

  if (!record) {
    return undefined;
  }

  if (record.expiresAt <= Date.now()) {
    tokens.delete(tokenHash);
    return undefined;
  }

  sessions.set(socket, tokenHash);
  return record.user;
}

/** 获取当前连接的有效登录身份。 */
export function getSession(
  socket: WebSocket,
): AuthenticatedUser | undefined {
  const tokenHash = sessions.get(socket);

  if (!tokenHash) {
    return undefined;
  }

  const record = tokens.get(tokenHash);

  if (!record || record.expiresAt <= Date.now()) {
    sessions.delete(socket);
    tokens.delete(tokenHash);
    return undefined;
  }

  return record.user;
}

/** 连接断开时解除绑定，但保留可恢复的令牌。 */
export function clearSession(socket: WebSocket): void {
  sessions.delete(socket);
}

/** 主动退出登录时撤销令牌。 */
export function revokeSession(socket: WebSocket): void {
  const tokenHash = sessions.get(socket);

  if (tokenHash) {
    tokens.delete(tokenHash);
    sessions.delete(socket);
  }
}

// 定期清理过期令牌，避免长期占用内存。
const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [tokenHash, record] of tokens) {
    if (record.expiresAt <= now) {
      tokens.delete(tokenHash);
    }
  }
}, 30 * 60 * 1000);

cleanupTimer.unref();
