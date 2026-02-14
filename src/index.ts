import { Hono } from "hono";
import { cors } from "hono/cors";
import { commentsRoute } from "./routes/comments";
import { adminRoute } from "./routes/admin";
import { pageviewsRoute } from "./routes/pageviews";
import { imagesRoute } from "./routes/images";
import contributionsRoute from "./routes/contributions";

// 扩展 Env 接口
export interface Env {
  kon_blog_db: D1Database;
  VIEW_KV: KVNamespace;
  IMAGE_BUCKET: R2Bucket;
  CF_ACCOUNT_HASH?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

// 创建应用
const app = new Hono<{ Bindings: Env }>();

// CORS 配置（允许博客域名访问）
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      // 允许的域名列表
      const allowedOrigins = [
        "https://kon-carol.xyz",
        "https://www.kon-carol.xyz",
        "https://blog.kon-carol.xyz",
        "https://carols-blog.pages.dev",
        "http://localhost:4321",
        "http://localhost:8787",
      ];

      // 检查是否在允许列表中
      if (allowedOrigins.includes(origin)) {
        return origin;
      }

      // 允许所有 carols-blog.pages.dev 的子域名（预览部署）
      if (origin?.match(/^https:\/\/[a-z0-9-]+\.carols-blog\.pages\.dev$/)) {
        return origin;
      }

      // 默认不允许
      return null;
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: false,
    maxAge: 86400,
  })
);

// 健康检查
app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    service: "kon-blog-api",
    version: "1.0.0",
    time: new Date().toISOString(),
  });
});

// 评论路由
app.route("/api/comments", commentsRoute);

// 浏览量统计路由
app.route("/api/views", pageviewsRoute);

// 图片管理路由
app.route("/api/images", imagesRoute);

// 贡献统计路由（GitHub + GitCode 合并）
app.route("/api/contributions", contributionsRoute);

// 头像代理 - 缓存 GitHub 头像到 R2 和 CDN，加速访问
app.get("/avatar", async (c) => {
  const GITHUB_USERNAME = "Carolier2003";
  const R2_KEY = "avatar/github-profile.png";
  const CACHE_TTL = 3600; // 1 小时

  // 检查 CDN 缓存（Edge Cache）
  const cacheUrl = new URL(c.req.url);
  const cacheKey = new Request(cacheUrl.toString(), c.req.raw);
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    return new Response(cachedResponse.body, {
      status: 200,
      headers: {
        "Content-Type": cachedResponse.headers.get("content-type") || "image/png",
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
        "X-Cache": "EDGE_HIT",
      },
    });
  }

  try {
    // 1. 尝试从 R2 获取缓存
    const cached = await c.env.IMAGE_BUCKET.get(R2_KEY);

    if (cached) {
      // 检查缓存时间
      const metadata = cached.customMetadata;
      const cachedAt = metadata?.cachedAt ? parseInt(metadata.cachedAt) : 0;
      const age = Date.now() - cachedAt;

      // 缓存未过期（1小时内），直接返回并缓存到 CDN
      if (age < CACHE_TTL * 1000) {
        const body = await cached.arrayBuffer();
        const response = new Response(body, {
          status: 200,
          headers: {
            "Content-Type": cached.httpMetadata?.contentType || "image/png",
            "Cache-Control": `public, max-age=${CACHE_TTL}`,
            "X-Cache": "R2_HIT",
          },
        });
        // 同时存入 CDN 缓存
        c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      }
    }

    // 2. 缓存不存在或已过期，从 GitHub 获取
    const githubResponse = await fetch(`https://github.com/${GITHUB_USERNAME}.png?size=200`, {
      headers: {
        "User-Agent": "kon-blog-api/1.0",
      },
    });

    if (!githubResponse.ok) {
      // 如果 GitHub 失败但有旧缓存，返回旧缓存
      if (cached) {
        const body = await cached.arrayBuffer();
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": cached.httpMetadata?.contentType || "image/png",
            "X-Cache": "STALE",
          },
        });
      }
      return c.json({ error: "Failed to fetch avatar" }, 500);
    }

    // 3. 获取图片数据
    const imageBuffer = await githubResponse.arrayBuffer();
    const contentType = githubResponse.headers.get("content-type") || "image/png";

    // 4. 存入 R2 缓存
    c.executionCtx.waitUntil(
      c.env.IMAGE_BUCKET.put(R2_KEY, imageBuffer, {
        httpMetadata: { contentType },
        customMetadata: { cachedAt: Date.now().toString() },
      })
    );

    // 5. 返回图片并缓存到 CDN
    const response = new Response(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${CACHE_TTL}`,
        "X-Cache": "MISS",
      },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;

  } catch (error) {
    console.error("Avatar fetch error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// 管理后台路由（带 Basic Auth）
app.route("/admin", adminRoute);

// 404 处理
app.notFound((c) => {
  return c.json(
    {
      success: false,
      message: "API 端点不存在",
    },
    404
  );
});

// 错误处理
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json(
    {
      success: false,
      message: "服务器内部错误",
    },
    500
  );
});

export default app;
