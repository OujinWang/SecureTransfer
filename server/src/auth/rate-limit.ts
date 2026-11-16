interface LoginAttemptRecord {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const attempts = new Map<string, LoginAttemptRecord>();

/** 限制同一 IP 在固定时间窗口内的登录尝试次数。 */
export function allowLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record || now >= record.resetAt) {
    attempts.set(ip, {
      count: 1,
      resetAt: now + WINDOW_MS,
    });

    return true;
  }

  if (record.count >= MAX_ATTEMPTS) {
    return false;
  }

  record.count += 1;
  return true;
}

// 定期清理过期记录，避免长期占用内存。
const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [ip, record] of attempts) {
    if (now >= record.resetAt) {
      attempts.delete(ip);
    }
  }
}, WINDOW_MS);

cleanupTimer.unref();