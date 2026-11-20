import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { db } from "../db.js";

const deriveKey = promisify(scrypt);

interface UserRow {
  id: string;
  username: string;
  password_hash: Buffer;
  salt: Buffer;
}

type LoginResult =
  | {
      ok: true;
      user: {
        id: string;
        username: string;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

/** 校验用户凭据并返回登录结果。 */
export async function loginUser(
  payload: unknown,
): Promise<LoginResult> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid login data",
    };
  }

  const data = payload as Record<string, unknown>;
  const { username, password } = data;

  if (
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_]{3,32}$/.test(username) ||
    typeof password !== "string" ||
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > 128
  ) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    };
  }

  const user = db.prepare(`
    SELECT id, username, password_hash, salt
    FROM users
    WHERE username = ?
  `).get(username) as UserRow | undefined;

  // 用户不存在时仍执行一次密码派生，减小响应时间差异。
  const salt = user?.salt ?? Buffer.alloc(16);
  const expectedHash = user?.password_hash ?? Buffer.alloc(64);

  if (salt.length !== 16 || expectedHash.length !== 64) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    };
  }

  const derivedHash = await deriveKey(
    password,
    salt,
    expectedHash.length,
  ) as Buffer;

  const valid =
    expectedHash.length === derivedHash.length &&
    timingSafeEqual(expectedHash, derivedHash);

  if (!user || !valid) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password",
    };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      username: user.username,
    },
  };
}