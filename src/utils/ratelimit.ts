/**
 * 简单的 IP 限频实现（基于 D1）
 */

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 分钟窗口
const RATE_LIMIT_MAX = 5; // 每窗口最多 5 条评论

export async function checkRateLimit(
  db: D1Database,
  ipHash: string
): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString();

  // 查询窗口内的评论数
  const result = await db
    .prepare(
      `SELECT COUNT(*) as count FROM comments
       WHERE ip_hash = ? AND created_at > ?`
    )
    .bind(ipHash, windowStart)
    .first<{ count: number }>();

  const count = result?.count || 0;

  return {
    allowed: count < RATE_LIMIT_MAX,
    remaining: Math.max(0, RATE_LIMIT_MAX - count),
  };
}
