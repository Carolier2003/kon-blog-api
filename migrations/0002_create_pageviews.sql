-- Migration: 创建文章浏览量统计表
-- Created at: 2026-02-13

-- 页面浏览量表
CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  view_count INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug)
);

-- 限频表 (用于防止刷浏览量)
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用于快速查询文章浏览量
CREATE INDEX IF NOT EXISTS idx_pageviews_slug ON page_views(slug);

-- 用于热门文章排行查询
CREATE INDEX IF NOT EXISTS idx_pageviews_count ON page_views(view_count DESC);

-- 用于获取最近更新的文章
CREATE INDEX IF NOT EXISTS idx_pageviews_updated ON page_views(updated_at DESC);

-- 用于限频查询和清理
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_created ON rate_limits(created_at);
