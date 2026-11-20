interface LoginAttemptRecord {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 30;
const MAX_ATTEMPTS_PER_ACCOUNT = 10;

const ipAttempts = new Map<string, LoginAttemptRecord>();
const accountAttempts = new Map<string, LoginAttemptRecord>();

function isAllowed(
  records: Map<string, LoginAttemptRecord>,
  key: string,
  limit: number,
  now: number,
): boolean {
  const record = records.get(key);

  if (!record || now >= record.resetAt) {
    records.set(key, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count += 1;
  return true;
}

/** 同时限制来源 IP 和目标账号的登录尝试。 */
export function allowLoginAttempt(
  ip: string,
  username: string,
): boolean {
  const now = Date.now();
  const accountKey = username.toLowerCase();

  // 两个维度都必须通过，且每次尝试均计入 IP 维度。
  const ipAllowed = isAllowed(
    ipAttempts,
    ip,
    MAX_ATTEMPTS_PER_IP,
    now,
  );

  if (!ipAllowed) {
    return false;
  }

  return isAllowed(
    accountAttempts,
    accountKey,
    MAX_ATTEMPTS_PER_ACCOUNT,
    now,
  );
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const records of [ipAttempts, accountAttempts]) {
    for (const [key, record] of records) {
      if (now >= record.resetAt) {
        records.delete(key);
      }
    }
  }
}, WINDOW_MS);

cleanupTimer.unref();