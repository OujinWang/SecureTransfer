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
const MAX_SESSIONS_PER_USER = 5;

const tokens = new Map<string, SessionRecord>();
const sessions = new WeakMap<WebSocket, string>();

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function removeToken(tokenHash: string): void {
  tokens.delete(tokenHash);
}

function enforceSessionLimit(userId: string): void {
  const userSessions = [...tokens.entries()]
    .filter(([, record]) => record.user.id === userId)
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt);

  while (userSessions.length >= MAX_SESSIONS_PER_USER) {
    const oldest = userSessions.shift();

    if (oldest) {
      removeToken(oldest[0]);
    }
  }
}

/** 登录成功后签发新的会话令牌。 */
export function createSession(
  socket: WebSocket,
  user: AuthenticatedUser,
): string {
  revokeSession(socket);
  enforceSessionLimit(user.id);

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);

  tokens.set(tokenHash, {
    user: { ...user },
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
  // 恢复失败时不得保留当前连接的旧身份。
  clearSession(socket);

  if (!/^[a-f0-9]{64}$/.test(token)) {
    return undefined;
  }

  const tokenHash = hashToken(token);
  const record = tokens.get(tokenHash);

  if (!record) {
    return undefined;
  }

  if (record.expiresAt <= Date.now()) {
    removeToken(tokenHash);
    return undefined;
  }

  sessions.set(socket, tokenHash);

  return { ...record.user };
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
    removeToken(tokenHash);
    return undefined;
  }

  return { ...record.user };
}

/** 连接断开时解除绑定，但保留可恢复的令牌。 */
export function clearSession(socket: WebSocket): void {
  sessions.delete(socket);
}

/** 主动退出登录时撤销令牌。 */
export function revokeSession(socket: WebSocket): void {
  const tokenHash = sessions.get(socket);

  if (tokenHash) {
    removeToken(tokenHash);
    sessions.delete(socket);
  }
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [tokenHash, record] of tokens) {
    if (record.expiresAt <= now) {
      removeToken(tokenHash);
    }
  }
}, 30 * 60 * 1000);

cleanupTimer.unref();