import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";

import { db } from "../db.js";

const deriveKey = promisify(scrypt);

type RegisterResult =
  | {
      ok: true;
      user: {
        id: string;
        username: string;
        isVip: boolean;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

/** 校验注册信息并创建用户。 */
export async function registerUser(
  payload: unknown,
): Promise<RegisterResult> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid registration data",
    };
  }

  const data = payload as Record<string, unknown>;
  const { username, password } = data;
  const isVip = data.isVip ?? false;

  if (typeof isVip !== "boolean") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid user type",
    };
  }

  if (
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_]{3,32}$/.test(username)
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Username must be 3-32 letters, digits or underscores",
    };
  }

  if (
    typeof password !== "string" ||
    [...password].length < 8 ||
    [...password].length > 20 ||
    Buffer.byteLength(password, "utf8") > 128
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Password must be 8-20 characters long",
    };
  }

  // 使用独立随机盐和 scrypt 派生密码哈希。
  const id = randomUUID();
  const salt = randomBytes(16);
  const passwordHash = await deriveKey(password, salt, 64);

  const result = db.prepare(`
    INSERT INTO users (id, username, password_hash, salt, is_vip)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO NOTHING
  `).run(id, username, passwordHash, salt, isVip ? 1 : 0);

  if (result.changes === 0) {
    return {
      ok: false,
      code: "USERNAME_TAKEN",
      message: "Username already exists",
    };
  }

  return {
    ok: true,
    user: { id, username, isVip },
  };
}