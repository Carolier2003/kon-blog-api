# 评论系统部署指南

## 功能特性

- ✏️ 匿名评论（无需登录）
- 💬 嵌套回复（支持多级回复）
- 🖼️ Gravatar 头像支持
- 🛡️ 防垃圾评论（关键词过滤 + IP 限频）
- 📝 简单的内容过滤（防 XSS）
- 📱 响应式设计

## 部署步骤

### 1. 创建 D1 数据库

```bash
cd worker/kon-blog-api

# 创建数据库
npx wrangler d1 create kon-blog-db
```

记录下输出的 `database_id`，然后更新 `wrangler.jsonc`：

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "kon-blog-db",
    "database_id": "your-database-id-here"  // 替换为实际的 ID
  }
]
```

### 2. 执行数据库迁移

```bash
# 本地测试
npx wrangler d1 execute kon-blog-db --local --file=./migrations/0001_create_comments.sql

# 生产环境
npx wrangler d1 execute kon-blog-db --remote --file=./migrations/0001_create_comments.sql
```

### 3. 本地测试

```bash
npm run dev
```

测试 API：

```bash
# 获取评论
curl http://localhost:8787/api/comments/hello-world

# 发表评论
curl -X POST http://localhost:8787/api/comments/hello-world \
  -H "Content-Type: application/json" \
  -d '{"author_name":"测试用户","content":"这是一条测试评论"}'
```

### 4. 部署 Worker

```bash
npm run deploy
```

### 5. 集成到博客页面

编辑 `Carols-blog/src/layouts/PostDetails.astro`：

**步骤 1**: 导入 Comments 组件

```astro
---
// 在文件顶部添加
import Comments from "@/components/Comments.astro";
---
```

**步骤 2**: 在页面底部添加评论组件

找到 `</main>` 标签，在其**之前**添加：

```astro
<!-- 在 ShareLinks 之后添加 -->
<ShareLinks />

<!-- 评论区域 -->
<Comments slug={post.id} />
```

完整位置参考（约第 127-130 行）：

```astro
<ShareLinks />

<!-- 添加这一行 -->
<Comments slug={post.id} />

<hr class="my-6 border-dashed" />
```

## 管理评论

### 查看待审核评论

```sql
-- 登录 D1 控制台或使用 Wrangler
npx wrangler d1 execute kon-blog-db --remote --command="SELECT * FROM comments WHERE status = 'spam' ORDER BY created_at DESC"
```

### 手动审核

```sql
-- 批准评论
UPDATE comments SET status = 'approved' WHERE id = 123;

-- 删除垃圾评论
DELETE FROM comments WHERE id = 123;

-- 查看某篇文章的所有评论
SELECT * FROM comments WHERE slug = 'your-post-slug' ORDER BY created_at DESC;
```

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/comments/:slug` | GET | 获取文章评论列表 |
| `/api/comments/:slug/count` | GET | 获取评论数量 |
| `/api/comments/:slug` | POST | 提交新评论 |

### POST 请求体

```json
{
  "author_name": "用户名（必填）",
  "author_email": "邮箱（可选，用于 Gravatar）",
  "author_website": "网站（可选）",
  "content": "评论内容（必填）",
  "parent_id": 123  // 回复哪条评论（可选）
}
```

## 配置说明

### 修改 CORS（允许其他域名）

编辑 `src/index.ts`：

```typescript
app.use("/api/*", cors({
  origin: [
    "https://your-domain.com",  // 添加你的域名
    "http://localhost:4321",
  ],
  // ...
}));
```

### 调整限频策略

编辑 `src/utils/ratelimit.ts`：

```typescript
const RATE_LIMIT_WINDOW = 60 * 1000;  // 1 分钟窗口
const RATE_LIMIT_MAX = 5;              // 最多 5 条评论
```

### 添加垃圾关键词

编辑 `src/utils/spamfilter.ts`：

```typescript
const SPAM_KEYWORDS = [
  "viagra",
  "casino",
  // 添加更多关键词...
];
```

## 前端组件自定义

评论组件使用 CSS 变量与博客主题保持一致：

- `--background` - 背景色
- `--foreground` - 文字色
- `--accent` - 强调色
- `--muted` - 次要文字
- `--border` - 边框色

如需调整样式，编辑 `src/components/Comments.astro` 中的 `<style>` 部分。

## 常见问题

### 跨域错误

确保 `wrangler.jsonc` 中的域名和博客域名匹配，且 `index.ts` 中的 CORS 配置正确。

### 头像不显示

检查邮箱是否正确，Gravatar 使用邮箱 MD5 hash。如果没有头像，会显示 identicon 占位图。

### 评论提交失败

检查浏览器控制台的网络请求，确认：
1. Worker 正常运行
2. D1 数据库已绑定
3. 请求体格式正确

## 后续扩展建议

1. **邮件通知** - 使用 Cloudflare Email Routing 或第三方服务
2. **管理后台** - 添加简单的管理员认证页面
3. **评论导入** - 从其他系统（如 Disqus）导入历史评论
4. **富文本** - 支持 Markdown 语法
5. **表情包** - 添加 emoji 选择器
