/**
 * 评论管理后台路由
 */
import { Hono, type Context } from "hono";
import type { Env } from "../index";
import { CommentRepository } from "../db/comments";

// 获取 D1 数据库的辅助函数
const getDB = (c: any): D1Database => c.env.kon_blog_db;

// 管理页面 HTML
const adminHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>评论管理后台</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      background: #fff;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 {
      font-size: 24px;
      color: #1a1a1a;
    }
    .subtitle {
      color: #666;
      font-size: 14px;
      margin-top: 4px;
    }
    .comment-card {
      background: #fff;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .comment-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #e1e4e8;
    }
    .author-info {
      flex: 1;
    }
    .author-name {
      font-weight: 600;
      color: #1a1a1a;
    }
    .author-email {
      font-size: 13px;
      color: #666;
    }
    .meta {
      display: flex;
      gap: 12px;
      font-size: 13px;
      color: #888;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge-pending {
      background: #fff3cd;
      color: #856404;
    }
    .badge-spam {
      background: #f8d7da;
      color: #721c24;
    }
    .post-link {
      color: #0366d6;
      text-decoration: none;
    }
    .post-link:hover {
      text-decoration: underline;
    }
    .comment-content {
      background: #f6f8fa;
      padding: 16px;
      border-radius: 6px;
      margin: 12px 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .comment-actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-approve {
      background: #2ea44f;
      color: #fff;
      border-color: #2ea44f;
    }
    .btn-approve:hover {
      background: #2c974b;
    }
    .btn-reject {
      background: #fff;
      color: #d73a49;
      border-color: #d73a49;
    }
    .btn-reject:hover {
      background: #ffeef0;
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #666;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .toast {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: #fff;
      font-size: 14px;
      z-index: 1000;
      animation: slideIn 0.3s ease;
    }
    .toast.success {
      background: #2ea44f;
    }
    .toast.error {
      background: #d73a49;
    }
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📝 评论管理后台</h1>
      <div class="subtitle">审核待处理的评论</div>
    </header>
    <div id="comments-list">
      <div class="loading">加载中...</div>
    </div>
  </div>

  <script>
    const API_BASE = '/api/admin';

    async function loadComments() {
      try {
        const res = await fetch(\`\${API_BASE}/comments\`);
        const data = await res.json();
        if (data.success) {
          renderComments(data.comments);
        } else {
          showError('加载失败');
        }
      } catch (err) {
        showError('加载失败: ' + err.message);
      }
    }

    function renderComments(comments) {
      const container = document.getElementById('comments-list');
      if (comments.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">🎉</div>
            <div>没有待审核的评论</div>
          </div>
        \`;
        return;
      }

      container.innerHTML = comments.map(c => \`
        <div class="comment-card" data-id="\${c.id}">
          <div class="comment-header">
            <img src="https://www.gravatar.com/avatar/\${c.author_email ? md5(c.author_email) : ''}?d=mp&s=80" class="avatar" alt="">
            <div class="author-info">
              <div class="author-name">\${escapeHtml(c.author_name)}</div>
              <div class="author-email">\${escapeHtml(c.author_email || '无邮箱')}</div>
            </div>
          </div>
          <div class="meta">
            <span class="badge badge-\${c.status}">\${c.status === 'spam' ? '垃圾评论' : '待审核'}</span>
            <span>文章: <a href="https://blog.kon-carol.xyz/posts/\${c.slug}/" target="_blank" class="post-link">\${c.slug}</a></span>
            <span>\${new Date(c.created_at).toLocaleString('zh-CN')}</span>
            <span>IP: \${c.ip_hash.slice(0, 8)}...</span>
          </div>
          <div class="comment-content">\${escapeHtml(c.content)}</div>
          <div class="comment-actions">
            <button class="btn btn-approve" onclick="handleAction(\${c.id}, 'approve')">✓ 批准</button>
            <button class="btn btn-reject" onclick="handleAction(\${c.id}, 'reject')">✗ 拒绝</button>
          </div>
        </div>
      \`).join('');
    }

    async function handleAction(id, action) {
      const card = document.querySelector(\`[data-id="\${id}"]\`);
      const buttons = card.querySelectorAll('.btn');
      buttons.forEach(b => b.disabled = true);

      try {
        const res = await fetch(\`\${API_BASE}/comments/\${id}/\${action}\`, {
          method: 'POST'
        });
        const data = await res.json();
        if (data.success) {
          showToast(action === 'approve' ? '已批准' : '已拒绝', 'success');
          card.style.opacity = '0.5';
          setTimeout(() => card.remove(), 300);
          // 检查是否还有评论
          setTimeout(() => {
            if (document.querySelectorAll('.comment-card').length === 0) {
              loadComments();
            }
          }, 300);
        } else {
          showToast(data.message || '操作失败', 'error');
          buttons.forEach(b => b.disabled = false);
        }
      } catch (err) {
        showToast('操作失败: ' + err.message, 'error');
        buttons.forEach(b => b.disabled = false);
      }
    }

    function showToast(message, type) {
      const toast = document.createElement('div');
      toast.className = \`toast \${type}\`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    function showError(msg) {
      document.getElementById('comments-list').innerHTML =
        \`<div class="empty-state"><div class="empty-icon">⚠️</div><div>\${msg}</div></div>\`;
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function md5(string) {
      // 简单的 MD5 实现（仅用于 Gravatar）
      if (!string) return '';
      return string.toLowerCase().trim();
    }

    loadComments();
  </script>
</body>
</html>
`;

// 简单的 Basic Auth 中间件
const simpleBasicAuth = async (c: Context, next: () => Promise<void>) => {
  const authHeader = c.req.header("Authorization");
  const env = c.env as Env;
  const expectedUsername = env.ADMIN_USERNAME || "admin";
  const expectedPassword = env.ADMIN_PASSWORD || "admin123";

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return c.text("Unauthorized", 401, {
      "WWW-Authenticate": 'Basic realm="Admin Area"',
    });
  }

  const base64 = authHeader.slice(6);
  const decoded = new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
  const [username, password] = decoded.split(":");

  if (username !== expectedUsername || password !== expectedPassword) {
    return c.text("Unauthorized", 401, {
      "WWW-Authenticate": 'Basic realm="Admin Area"',
    });
  }

  await next();
};

// 创建路由
export const adminRoute = new Hono<{ Bindings: Env }>()
  // Basic Auth 认证
  .use("/*", simpleBasicAuth)

  // 管理页面
  .get("/", (c) => {
    return c.html(adminHtml);
  })

  // 获取待审核评论列表
  .get("/api/admin/comments", async (c) => {
    const repo = new CommentRepository(getDB(c));
    try {
      const comments = await repo.getPending(50);
      return c.json({ success: true, comments });
    } catch (error) {
      console.error("Failed to fetch pending comments:", error);
      return c.json({ success: false, message: "获取评论失败" }, 500);
    }
  })

  // 批准评论
  .post("/api/admin/comments/:id/approve", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, message: "无效的评论 ID" }, 400);
    }

    const repo = new CommentRepository(getDB(c));
    try {
      await repo.updateStatus(id, "approved");
      return c.json({ success: true, message: "已批准" });
    } catch (error) {
      console.error("Failed to approve comment:", error);
      return c.json({ success: false, message: "操作失败" }, 500);
    }
  })

  // 拒绝评论
  .post("/api/admin/comments/:id/reject", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (isNaN(id)) {
      return c.json({ success: false, message: "无效的评论 ID" }, 400);
    }

    const repo = new CommentRepository(getDB(c));
    try {
      await repo.updateStatus(id, "rejected");
      return c.json({ success: true, message: "已拒绝" });
    } catch (error) {
      console.error("Failed to reject comment:", error);
      return c.json({ success: false, message: "操作失败" }, 500);
    }
  });
