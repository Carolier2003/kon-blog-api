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
/**
 * 使用 Cloudflare Cache API 缓存响应
 */
async function cacheResponse(c: any, key: string, data: any, ttlSeconds: number = 60) {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.kon-carol.xyz/${key}`, {
    method: 'GET'
  });

  const response = new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `max-age=${ttlSeconds}`,
    }
  });

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

/**
 * 从 Cloudflare Cache 获取缓存
 */
async function getCachedResponse(c: any, key: string): Promise<any | null> {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.kon-carol.xyz/${key}`, {
    method: 'GET'
  });

  const cached = await cache.match(cacheKey);
  if (cached) {
    return await cached.json();
  }
  return null;
}

// 创建路由
export const pageviewsRoute = new Hono<{ Bindings: Env }>()
  // 批量获取文章浏览量（放在 /:slug 之前，避免被捕获）
  .post("/batch", async (c) => {
    const db = getDB(c);

    try {
      const body = await c.req.json<{ slugs: string[] }>();
      const slugs = body.slugs?.filter(Boolean) ?? [];

      // 限制批量查询数量
      if (slugs.length === 0 || slugs.length > 100) {
        return c.json(
          { success: false, message: "无效的请求，slugs 数量必须在 1-100 之间" },
          400
        );
      }

      // 生成缓存 key（排序后确保一致性）
      const cacheKey = `batch:${slugs.slice().sort().join(',')}`;

      // 尝试从缓存获取
      const cached = await getCachedResponse(c, cacheKey);
      if (cached) {
        return c.json(cached, 200, {
          "Cache-Control": "public, max-age=60",
          "X-Cache": "HIT"
        });
      }

      const repo = new PageViewRepository(db);
      const views = await repo.getMany(slugs);

      // 确保所有请求的 slug 都有返回值（没有的补 0）
      const result: Record<string, number> = {};
      slugs.forEach(slug => {
        result[slug] = views[slug] ?? 0;
      });

      const responseData = {
        success: true,
        views: result
      };

      // 缓存 1 分钟（减少 D1 查询）
      await cacheResponse(c, cacheKey, responseData, 60);

      return c.json(responseData, 200, {
        // 浏览器缓存 1 小时，stale-while-revalidate 1 天
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Cache": "MISS"
      });
    } catch (error) {
      console.error("Failed to get batch view counts:", error);
      return c.json(
        { success: false, message: "批量获取浏览量失败" },
        500
      );
    }
  })

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
      }, 200, {
        // 缓存 5 分钟
        "Cache-Control": "public, max-age=300"
      });
    } catch (error) {
      console.error("Failed to get view count:", error);
      return c.json(
        { success: false, message: "获取浏览量失败" },
        500
      );
    }
  });
