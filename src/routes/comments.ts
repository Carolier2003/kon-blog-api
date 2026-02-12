/**
 * 评论 API 路由
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { CommentRepository } from "../db/comments";
import { getGravatarUrl } from "../utils/gravatar";
import { checkRateLimit } from "../utils/ratelimit";
import { checkSpam } from "../utils/spamfilter";
import type { CommentWithReplies } from "../types";

// 请求参数验证 schema
const submitSchema = z.object({
  author_name: z.string().min(1, "名称不能为空").max(50, "名称太长"),
  author_email: z.string().email("邮箱格式不正确").optional().or(z.literal("")),
  author_website: z
    .string()
    .url("网站地址格式不正确")
    .optional()
    .or(z.literal("")),
  content: z.string().min(1, "评论内容不能为空").max(5000, "评论太长"),
  parent_id: z.number().int().positive().optional(),
});

// 获取 D1 数据库的辅助函数
const getDB = (c: any): D1Database => c.env.kon_blog_db;

// 创建路由
export const commentsRoute = new Hono<{ Bindings: Env }>()
  // 获取文章评论列表
  .get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const repo = new CommentRepository(getDB(c));

    try {
      const comments = await repo.getBySlug(slug);

      // 添加 Gravatar 头像
      const commentsWithAvatar = comments.map((comment) =>
        addAvatarUrl(comment)
      );

      return c.json({
        success: true,
        comments: commentsWithAvatar,
        total: comments.length,
      });
    } catch (error) {
      console.error("Failed to fetch comments:", error);
      return c.json(
        { success: false, message: "获取评论失败" },
        500
      );
    }
  })

  // 获取评论数量
  .get("/:slug/count", async (c) => {
    const slug = c.req.param("slug");
    const repo = new CommentRepository(getDB(c));

    try {
      const count = await repo.countBySlug(slug);
      return c.json({ success: true, count });
    } catch (error) {
      console.error("Failed to count comments:", error);
      return c.json(
        { success: false, message: "获取评论数失败" },
        500
      );
    }
  })

  // 提交新评论
  .post("/:slug", zValidator("json", submitSchema), async (c) => {
    const slug = c.req.param("slug");
    const data = c.req.valid("json");
    const db = getDB(c);
    const repo = new CommentRepository(db);

    // 获取客户端信息
    const ip = c.req.header("CF-Connecting-IP") || "unknown";
    const userAgent = c.req.header("User-Agent") || "";

    // 简单的 IP hash（隐私保护）
    const ipHash = await hashString(ip);

    try {
      // 检查限频
      const rateLimit = await checkRateLimit(db, ipHash);
      if (!rateLimit.allowed) {
        return c.json(
          { success: false, message: "评论太频繁，请稍后再试" },
          429
        );
      }

      // 检查垃圾评论
      const spamCheck = checkSpam(data.content, data.author_name);

      // 创建评论（状态根据垃圾检查结果）
      const comment = await repo.create(
        slug,
        {
          author_name: sanitizeHtml(data.author_name),
          author_email: data.author_email || undefined,
          author_website: data.author_website || undefined,
          content: sanitizeHtml(data.content),
          parent_id: data.parent_id,
        },
        ipHash,
        userAgent.slice(0, 500) // 限制长度
      );

      // 如果疑似垃圾，更新状态
      if (spamCheck.isSpam) {
        await db
          .prepare("UPDATE comments SET status = 'spam' WHERE id = ?")
          .bind(comment.id)
          .run();
        comment.status = "spam";
      }

      return c.json(
        {
          success: true,
          message:
            comment.status === "spam"
              ? "评论已提交，等待审核"
              : "评论发布成功",
          comment: {
            ...comment,
            avatar_url: getGravatarUrl(comment.author_email),
          },
        },
        201
      );
    } catch (error) {
      console.error("Failed to create comment:", error);
      return c.json(
        { success: false, message: "发布评论失败，请稍后重试" },
        500
      );
    }
  });

/**
 * 为评论添加 Gravatar URL
 */
function addAvatarUrl(comment: CommentWithReplies): CommentWithReplies {
  const result: CommentWithReplies = {
    ...comment,
    avatar_url: getGravatarUrl(comment.author_email),
  };

  if (comment.replies && comment.replies.length > 0) {
    result.replies = comment.replies.map((reply) => addAvatarUrl(reply));
  }

  return result;
}

/**
 * 简单的字符串 hash
 */
async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 简单的 HTML 转义（防止 XSS）
 */
function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
