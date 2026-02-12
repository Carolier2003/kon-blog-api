/**
 * 页面浏览量数据库操作类
 */
export class PageViewRepository {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /**
   * 增加文章浏览量
   * @param slug 文章 slug
   * @returns 更新后的浏览量
   */
  async increment(slug: string): Promise<number> {
    // 使用 INSERT OR REPLACE 原子操作
    const result = await this.db
      .prepare(`
        INSERT INTO page_views (slug, view_count, updated_at)
        VALUES (?, 1, datetime('now'))
        ON CONFLICT(slug) DO UPDATE SET
          view_count = view_count + 1,
          updated_at = datetime('now')
        RETURNING view_count
      `)
      .bind(slug)
      .first<{ view_count: number }>();

    return result?.view_count ?? 0;
  }

  /**
   * 获取文章浏览量
   * @param slug 文章 slug
   * @returns 浏览量（文章不存在返回 0）
   */
  async get(slug: string): Promise<number> {
    const result = await this.db
      .prepare('SELECT view_count FROM page_views WHERE slug = ?')
      .bind(slug)
      .first<{ view_count: number }>();

    return result?.view_count ?? 0;
  }

  /**
   * 批量获取文章浏览量
   * @param slugs 文章 slug 数组
   * @returns slug -> view_count 的映射
   */
  async getMany(slugs: string[]): Promise<Record<string, number>> {
    if (slugs.length === 0) {
      return {};
    }

    // 使用参数化查询，防止 SQL 注入
    const placeholders = slugs.map(() => '?').join(',');
    const results = await this.db
      .prepare(`SELECT slug, view_count FROM page_views WHERE slug IN (${placeholders})`)
      .bind(...slugs)
      .all<{ slug: string; view_count: number }>();

    const views: Record<string, number> = {};
    results.results?.forEach(row => {
      views[row.slug] = row.view_count;
    });

    return views;
  }

  /**
   * 获取热门文章排行
   * @param limit 返回数量
   * @returns 热门文章列表
   */
  async getPopular(limit: number = 10): Promise<Array<{ slug: string; view_count: number }>> {
    const results = await this.db
      .prepare(`
        SELECT slug, view_count
        FROM page_views
        ORDER BY view_count DESC, updated_at DESC
        LIMIT ?
      `)
      .bind(limit)
      .all<{ slug: string; view_count: number }>();

    return results.results ?? [];
  }

  /**
   * 获取总浏览量
   * @returns 所有文章浏览量总和
   */
  async getTotalViews(): Promise<number> {
    const result = await this.db
      .prepare('SELECT SUM(view_count) as total FROM page_views')
      .first<{ total: number }>();

    return result?.total ?? 0;
  }
}
