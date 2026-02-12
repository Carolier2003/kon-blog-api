/**
 * 评论数据库操作
 */
import type { Comment, CommentWithReplies, CreateCommentInput } from "../types";

export class CommentRepository {
  constructor(private db: D1Database) {}

  /**
   * 获取文章的评论列表
   */
  async getBySlug(slug: string): Promise<CommentWithReplies[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM comments
         WHERE slug = ? AND status = 'approved'
         ORDER BY created_at ASC`
      )
      .bind(slug)
      .all<Comment>();

    return this.nestComments(results || []);
  }

  /**
   * 获取评论总数
   */
  async countBySlug(slug: string): Promise<number> {
    const result = await this.db
      .prepare(
        `SELECT COUNT(*) as count FROM comments
         WHERE slug = ? AND status = 'approved'`
      )
      .bind(slug)
      .first<{ count: number }>();

    return result?.count || 0;
  }

  /**
   * 创建新评论
   */
  async create(
    slug: string,
    input: CreateCommentInput,
    ipHash: string,
    userAgent: string
  ): Promise<Comment> {
    const { author_name, author_email, author_website, content, parent_id } = input;

    const result = await this.db
      .prepare(
        `INSERT INTO comments
         (slug, parent_id, author_name, author_email, author_website, content, ip_hash, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`
      )
      .bind(
        slug,
        parent_id || null,
        author_name,
        author_email || null,
        author_website || null,
        content,
        ipHash,
        userAgent
      )
      .first<Comment>();

    if (!result) {
      throw new Error("Failed to create comment");
    }

    return result;
  }

  /**
   * 获取待审核的评论列表（管理后台用）
   */
  async getPending(limit: number = 50): Promise<Comment[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM comments
         WHERE status IN ('pending', 'spam')
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all<Comment>();

    return results || [];
  }

  /**
   * 更新评论状态
   */
  async updateStatus(id: number, status: 'approved' | 'rejected' | 'spam'): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE comments
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(status, id)
      .run();

    return result.success;
  }

  /**
   * 将评论列表转换为嵌套结构
   */
  private nestComments(comments: Comment[]): CommentWithReplies[] {
    const commentMap = new Map<number, CommentWithReplies>();
    const rootComments: CommentWithReplies[] = [];

    // 先创建映射
    for (const comment of comments) {
      commentMap.set(comment.id, { ...comment, replies: [] });
    }

    // 构建嵌套关系
    for (const comment of comments) {
      const node = commentMap.get(comment.id)!;
      if (comment.parent_id && commentMap.has(comment.parent_id)) {
        const parent = commentMap.get(comment.parent_id)!;
        if (!parent.replies) parent.replies = [];
        parent.replies.push(node);
      } else {
        rootComments.push(node);
      }
    }

    return rootComments;
  }
}
