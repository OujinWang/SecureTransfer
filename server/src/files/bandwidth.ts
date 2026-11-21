
const NORMAL_RATE = 256 * 1024;
const VIP_RATE = 1024 * 1024;

// 为每个用户记录下一次可完成数据传输的时间。
const nextAvailable = new Map<string, number>();

export async function limitBandwidth(
  userId: string,
  isVip: boolean,
  bytes: number,
): Promise<void> {
  if (bytes <= 0) return;

  const rate = isVip ? VIP_RATE : NORMAL_RATE;

  const now = performance.now();
  const start = Math.max(now, nextAvailable.get(userId) ?? now);
  const finish = start + (bytes / rate) * 1000;

  nextAvailable.set(userId, finish);

  const delay = Math.max(0, finish - now);
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

// 定期清理不活跃用户的记录。
setInterval(() => {
  const cutoff = performance.now() - 60_000;

  for (const [userId, time] of nextAvailable) {
    if (time < cutoff) {
      nextAvailable.delete(userId);
    }
  }
}, 60_000).unref();
