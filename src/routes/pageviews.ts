/**
 * 页面浏览量 API 路由 - KV 缓存优化版
 *
 * 架构：
 * - 写入：D1（持久化）+ KV（缓存）双写
 * - 读取：KV（极速）→ D1（回源）
 * - 预期延迟：KV < 10ms，D1 50-150ms
 */
import { Hono } from "hono";
import { PageViewRepository } from "../db/pageviews";

// KV 缓存 key 前缀
const KV_PREFIX = "views:v1:";
const KV_BATCH_PREFIX = "views:batch:v1:";
// KV 缓存时间（秒）- 7天
const KV_TTL = 7 * 24 * 60 * 60;

// 获取 D1 数据库的辅助函数
const getDB = (c: any): D1Database => c.env.kon_blog_db;
// 获取 KV 的辅助函数
const getKV = (c: any): KVNamespace => c.env.VIEW_KV;

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

/**
 * 从 KV 获取单篇文章浏览量
 */
async function getFromKV(kv: KVNamespace, slug: string): Promise<number | null> {
  try {
    const value = await kv.get(`${KV_PREFIX}${slug}`);
    if (value !== null) {
      return parseInt(value, 10);
    }
  } catch (e) {
    console.error("KV get error:", e);
  }
  return null;
}

/**
 * 写入 KV（双写策略）
 */
async function writeToKV(kv: KVNamespace, slug: string, count: number): Promise<void> {
  try {
    await kv.put(`${KV_PREFIX}${slug}`, count.toString(), { expirationTtl: KV_TTL });
  } catch (e) {
    console.error("KV write error:", e);
  }
}

/**
 * 批量从 KV 获取
 */
async function getManyFromKV(
  kv: KVNamespace,
  slugs: string[]
): Promise<{ found: Record<string, number>; missing: string[] }> {
  const found: Record<string, number> = {};
  const missing: string[] = [];

  // 先尝试从 KV 批量获取（使用缓存的聚合结果）
  const cacheKey = `${KV_BATCH_PREFIX}${slugs.slice().sort().join(',')}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      // 检查是否包含所有需要的 slugs
      const hasAll = slugs.every(slug => data[slug] !== undefined);
      if (hasAll) {
        return { found: data, missing: [] };
      }
    }
  } catch (e) {
    // 缓存未命中或解析失败，继续单独获取
  }

  // 单独获取每个 slug
  await Promise.all(
    slugs.map(async (slug) => {
      const value = await getFromKV(kv, slug);
      if (value !== null) {
        found[slug] = value;
      } else {
        missing.push(slug);
      }
    })
  );

  return { found, missing };
}

/**
 * 批量写入 KV
 */
async function writeManyToKV(kv: KVNamespace, views: Record<string, number>): Promise<void> {
  try {
    await Promise.all(
      Object.entries(views).map(([slug, count]) =>
        writeToKV(kv, slug, count)
      )
    );
  } catch (e) {
    console.error("KV batch write error:", e);
  }
}

// 创建路由
export const pageviewsRoute = new Hono<{ Bindings: Env }>()
  // 批量获取文章浏览量（KV 优先）
  .get("/batch", async (c) => {
    const db = getDB(c);
    const kv = getKV(c);

    try {
      // 从 query 参数获取 slugs，逗号分隔
      const slugsParam = c.req.query("slugs");
      const slugs = slugsParam ? slugsParam.split(",").filter(Boolean) : [];

      // 限制批量查询数量
      if (slugs.length === 0 || slugs.length > 100) {
        return c.json(
          { success: false, message: "无效的请求，slugs 数量必须在 1-100 之间" },
          400
        );
      }

      // 1. 优先从 KV 获取（极速 < 10ms）
      const { found, missing } = await getManyFromKV(kv, slugs);

      // 2. KV 缺失的，回源到 D1 查询
      let dbResults: Record<string, number> = {};
      if (missing.length > 0) {
        const repo = new PageViewRepository(db);
        dbResults = await repo.getMany(missing);

        // 异步回写 KV（不阻塞响应）
        c.executionCtx.waitUntil(
          writeManyToKV(kv, dbResults).catch(() => {})
        );
      }

      // 3. 合并结果
      const result: Record<string, number> = { ...found };
      slugs.forEach(slug => {
        // 优先使用 KV 数据，否则用 D1 数据，默认 0
        result[slug] = found[slug] ?? dbResults[slug] ?? 0;
      });

      return c.json({
        success: true,
        views: result,
        _cache: missing.length === 0 ? "kv" : "mixed"
      }, 200, {
        // 浏览器缓存 1 小时，stale-while-revalidate 1 天
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      });
    } catch (error) {
      console.error("Failed to get batch view counts:", error);
      return c.json(
        { success: false, message: "批量获取浏览量失败" },
        500
      );
    }
  })

  // 获取热门文章排行
  .get("/popular", async (c) => {
    const db = getDB(c);

    // 解析 limit 参数
    const limitParam = c.req.query("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "10", 10), 1),
      100
    );

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

  // 记录文章浏览量（双写策略）
  .post("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = getDB(c);
    const kv = getKV(c);

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
        // 超过频率限制，从 KV 或 D1 获取当前计数
        let count = await getFromKV(kv, slug);
        if (count === null) {
          const repo = new PageViewRepository(db);
          count = await repo.get(slug);
        }

        return c.json({
          success: true,
          view_count: count,
          cached: true,
          message: "请求过于频繁，使用缓存数据"
        });
      }

      // 增加浏览量（D1）
      const repo = new PageViewRepository(db);
      const count = await repo.increment(slug);

      // 双写 KV（异步，不阻塞响应）
      c.executionCtx.waitUntil(
        writeToKV(kv, slug, count).catch(() => {})
      );

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

  // 获取单篇文章浏览量（KV 优先）
  .get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const db = getDB(c);
    const kv = getKV(c);

    // 验证 slug 格式
    if (!slug || slug.length > 500) {
      return c.json(
        { success: false, message: "无效的文章标识" },
        400
      );
    }

    try {
      // 1. 优先从 KV 读取
      let count = await getFromKV(kv, slug);

      // 2. KV 未命中，回源到 D1
      if (count === null) {
        const repo = new PageViewRepository(db);
        count = await repo.get(slug);

        // 异步回写 KV
        c.executionCtx.waitUntil(
          writeToKV(kv, slug, count).catch(() => {})
        );
      }

      return c.json({
        success: true,
        slug,
        view_count: count,
        _cache: count !== null ? "kv" : "db"
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
