import type WebSocket from "ws";

export interface AuthenticatedUser {
  id: string;
  username: string;
}

// 每条 WebSocket 连接独立维护认证身份。
const sessions = new WeakMap<WebSocket, AuthenticatedUser>();

/** 绑定连接的认证身份。 */
export function setSession(
  socket: WebSocket,
  user: AuthenticatedUser,
): void {
  sessions.set(socket, user);
}

/** 获取当前连接的认证身份。 */
export function getSession(
  socket: WebSocket,
): AuthenticatedUser | undefined {
  return sessions.get(socket);
}

/** 清除当前连接的认证身份。 */
export function clearSession(socket: WebSocket): void {
  sessions.delete(socket);
}