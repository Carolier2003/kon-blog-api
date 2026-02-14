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
    origin: [
      "https://kon-carol.xyz",
      "https://www.kon-carol.xyz",
      "https://blog.kon-carol.xyz",
      "https://carols-blog.pages.dev",
      "http://localhost:4321",
      "http://localhost:8787",
    ],
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
