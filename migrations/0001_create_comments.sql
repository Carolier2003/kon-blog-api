-- 评论表
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,              -- 文章路径，如 /posts/hello-world
  parent_id INTEGER,               -- 父评论 ID，用于嵌套回复
  author_name TEXT NOT NULL,       -- 评论者名称
  author_email TEXT,               -- 评论者邮箱（用于 Gravatar）
  author_website TEXT,             -- 个人网站（可选）
  content TEXT NOT NULL,           -- 评论内容
  status TEXT DEFAULT 'pending',   -- 状态: pending/approved/spam
  ip_hash TEXT,                    -- IP 地址哈希（用于防刷）
  user_agent TEXT,                 -- 浏览器信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);

-- 触发器：自动更新 updated_at
CREATE TRIGGER IF NOT EXISTS update_comments_timestamp
AFTER UPDATE ON comments
BEGIN
  UPDATE comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
