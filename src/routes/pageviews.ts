/**
 * 页面浏览量 API 路由
 */
import { Hono } from "hono";
import { PageViewRepository } from "../db/pageviews";

// 获取 D1 数据库的辅助函数
const getDB = (c: any): D1Database => c.env.kon_blog_db;

/**
 * 简单的字符串 hash (用于 IP 识别)
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 检查限频 (5 分钟内同一 IP 只计一次)
 */
async function checkRateLimit(
  db: D1Database,
  ipHash: string,
  slug: string
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `${ipHash}:${slug}`;

  // 检查是否存在记录
  const existing = await db
    .prepare(
      `SELECT created_at FROM rate_limits WHERE key = ? AND created_at > datetime('now', '-5 minutes')`
    )
    .bind(key)
    .first<{ created_at: string }>();

  if (existing) {
    return { allowed: false, remaining: 0 };
  }

  // 允许请求，插入/更新记录
  await db
    .prepare(
      `INSERT OR REPLACE INTO rate_limits (key, created_at) VALUES (?, datetime('now'))`
    )
    .bind(key)
    .run();

  return { allowed: true, remaining: 1 };
}

// 创建路由
export const pageviewsRoute = new Hono<{ Bindings: Env }>()
  // 获取热门文章排行（放在 /:slug 之前，避免被捕获）
  .get("/popular", async (c) => {
    const db = getDB(c);

    // 解析 limit 参数
    const limitParam = c.req.query("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "10", 10), 1),
      100
    ); // 限制 1-100

    try {
      const repo = new PageViewRepository(db);
      const popular = await repo.getPopular(limit);

      return c.json({
        success: true,
        limit,
        articles: popular
      });
    } catch (error) {
      console.error("Failed to get popular articles:", error);
      return c.json(
        { success: false, message: "获取热门文章失败" },
        500
      );
    }
  })

  // 记录文章浏览量
  .post("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = getDB(c);

    // 验证 slug 格式
    if (!slug || slug.length > 500 || slug.includes("..") || slug.startsWith("/")) {
      return c.json(
        { success: false, message: "无效的文章标识" },
        400
      );
    }

    // 获取客户端 IP
    const ip = c.req.header("CF-Connecting-IP") ||
               c.req.header("X-Forwarded-For") ||
               "unknown";

    try {
      // 检查限频
      const ipHash = await hashString(ip);
      const rateLimit = await checkRateLimit(db, ipHash, slug);

      if (!rateLimit.allowed) {
        // 超过频率限制，只返回当前计数，不增加
        const repo = new PageViewRepository(db);
        const count = await repo.get(slug);
        return c.json({
          success: true,
          view_count: count,
          cached: true,
          message: "请求过于频繁，使用缓存数据"
        });
      }

      // 增加浏览量
      const repo = new PageViewRepository(db);
      const count = await repo.increment(slug);

      return c.json({
        success: true,
        view_count: count
      });
    } catch (error) {
      console.error("Failed to increment view count:", error);
      return c.json(
        { success: false, message: "记录浏览量失败" },
        500
      );
    }
  })

  // 获取文章浏览量
  .get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = getDB(c);

    // 验证 slug 格式
    if (!slug || slug.length > 500) {
      return c.json(
        { success: false, message: "无效的文章标识" },
        400
      );
    }

    try {
      const repo = new PageViewRepository(db);
      const count = await repo.get(slug);

      return c.json({
        success: true,
        slug,
        view_count: count
      });
    } catch (error) {
      console.error("Failed to get view count:", error);
      return c.json(
        { success: false, message: "获取浏览量失败" },
        500
      );
    }
  });
