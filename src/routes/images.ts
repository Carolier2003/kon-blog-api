import { Hono } from "hono";
import type { Env } from "../index";

// 创建路由
const imagesRoute = new Hono<{ Bindings: Env }>();

// 允许的图片类型
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
];

// 文件扩展名映射
const EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

// 最大文件大小：10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 生成唯一文件名
function generateUniqueFilename(originalName: string, contentType: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const ext = EXTENSION_MAP[contentType] || "bin";

  // 清理原始文件名，移除扩展名和特殊字符
  const cleanName = originalName
    .replace(/\.[^/.]+$/, "") // 移除扩展名
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_") // 保留中英文、数字、下划线和连字符
    .substring(0, 30); // 限制长度

  return `${cleanName}_${timestamp}_${random}.${ext}`;
}

// 验证并获取图片变体参数
function parseVariantParams(url: URL): {
  width?: number;
  height?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  format?: "auto" | "webp" | "jpeg" | "png" | "gif" | "avif";
  quality?: number;
  dpr?: number;
} {
  const params: ReturnType<typeof parseVariantParams> = {};

  const width = url.searchParams.get("w") || url.searchParams.get("width");
  if (width) {
    const w = parseInt(width, 10);
    if (!isNaN(w) && w > 0 && w <= 4096) {
      params.width = w;
    }
  }

  const height = url.searchParams.get("h") || url.searchParams.get("height");
  if (height) {
    const h = parseInt(height, 10);
    if (!isNaN(h) && h > 0 && h <= 4096) {
      params.height = h;
    }
  }

  const fit = url.searchParams.get("fit") as typeof params.fit;
  if (fit && ["scale-down", "contain", "cover", "crop", "pad"].includes(fit)) {
    params.fit = fit;
  }

  const format = url.searchParams.get("f") || url.searchParams.get("format");
  if (format && ["auto", "webp", "jpeg", "png", "gif", "avif"].includes(format)) {
    params.format = format as typeof params.format;
  }

  const quality = url.searchParams.get("q") || url.searchParams.get("quality");
  if (quality) {
    const q = parseInt(quality, 10);
    if (!isNaN(q) && q >= 1 && q <= 100) {
      params.quality = q;
    }
  }

  const dpr = url.searchParams.get("dpr");
  if (dpr) {
    const d = parseFloat(dpr);
    if (!isNaN(d) && d >= 1 && d <= 3) {
      params.dpr = d;
    }
  }

  return params;
}

// 构建 Cloudflare Images URL
function buildImagesUrl(
  accountHash: string,
  key: string,
  variant: string,
  params?: ReturnType<typeof parseVariantParams>
): string {
  let url = `https://imagedelivery.net/${accountHash}/${key}/${variant}`;

  // 如果是自定义变体，添加查询参数
  if (variant === "custom" && params) {
    const searchParams = new URLSearchParams();
    if (params.width) searchParams.set("width", params.width.toString());
    if (params.height) searchParams.set("height", params.height.toString());
    if (params.fit) searchParams.set("fit", params.fit);
    if (params.format) searchParams.set("format", params.format);
    if (params.quality) searchParams.set("quality", params.quality.toString());
    if (params.dpr) searchParams.set("dpr", params.dpr.toString());

    const queryString = searchParams.toString();
    if (queryString) {
      url += "?" + queryString;
    }
  }

  return url;
}

// 获取图片（直接返回 R2 内容或重定向到 Images 服务）
imagesRoute.get("/view/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const useImages = c.req.query("images") !== "false"; // 默认使用 Images 服务
  const variant = c.req.query("variant") || "public"; // 默认变体

  try {
    // 如果配置使用 Cloudflare Images 服务，重定向到 Images URL
    if (useImages && c.env.CF_ACCOUNT_HASH) {
      const params = parseVariantParams(new URL(c.req.url));
      const imagesUrl = buildImagesUrl(
        c.env.CF_ACCOUNT_HASH,
        key,
        Object.keys(params).length > 0 ? "custom" : variant,
        params
      );

      return c.redirect(imagesUrl, 302);
    }

    // 否则直接从 R2 获取
    const object = await c.env.IMAGE_BUCKET.get(key);

    if (!object) {
      return c.json(
        {
          success: false,
          message: "图片不存在",
        },
        404
      );
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
    headers.set("cache-control", "public, max-age=31536000, immutable");

    return new Response(object.body, {
      headers,
    });
  } catch (error) {
    console.error("获取图片失败:", error);
    return c.json(
      {
        success: false,
        message: "获取图片失败",
      },
      500
    );
  }
});

// 上传图片
imagesRoute.post("/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const files = formData.getAll("files");

    if (files.length === 0) {
      return c.json(
        {
          success: false,
          message: "请选择要上传的文件",
        },
        400
      );
    }

    const uploadedFiles: Array<{
      key: string;
      originalName: string;
      size: number;
      contentType: string;
      url: string;
      markdown: string;
      imagesUrl?: string;
    }> = [];

    const errors: Array<{ filename: string; message: string }> = [];

    for (const file of files) {
      if (!(file instanceof File)) {
        continue;
      }

      // 验证文件类型
      if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
        errors.push({
          filename: file.name,
          message: `不支持的文件类型: ${file.type}。仅支持: ${ALLOWED_CONTENT_TYPES.join(", ")}`,
        });
        continue;
      }

      // 验证文件大小
      if (file.size > MAX_FILE_SIZE) {
        errors.push({
          filename: file.name,
          message: `文件过大: ${(file.size / 1024 / 1024).toFixed(2)}MB，最大允许 10MB`,
        });
        continue;
      }

      // 生成唯一文件名
      const key = generateUniqueFilename(file.name, file.type);

      // 上传到 R2
      await c.env.IMAGE_BUCKET.put(key, file, {
        httpMetadata: {
          contentType: file.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
        customMetadata: {
          originalName: file.name,
          uploadedAt: new Date().toISOString(),
          size: file.size.toString(),
        },
      });

      // 构建访问 URL
      const baseUrl = new URL(c.req.url);
      const imageUrl = `${baseUrl.origin}/api/images/view/${key}`;

      // 构建 Cloudflare Images URL（如果配置了 account hash）
      let imagesUrl: string | undefined;
      if (c.env.CF_ACCOUNT_HASH) {
        imagesUrl = buildImagesUrl(c.env.CF_ACCOUNT_HASH, key, "public");
      }

      uploadedFiles.push({
        key,
        originalName: file.name,
        size: file.size,
        contentType: file.type,
        url: imageUrl,
        markdown: `![${file.name}](${imagesUrl || imageUrl})`,
        imagesUrl,
      });
    }

    return c.json({
      success: errors.length === 0 || uploadedFiles.length > 0,
      message:
        uploadedFiles.length > 0
          ? `成功上传 ${uploadedFiles.length} 个文件${errors.length > 0 ? `，${errors.length} 个失败` : ""}`
          : "上传失败",
      data: {
        uploaded: uploadedFiles,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("上传失败:", error);
    return c.json(
      {
        success: false,
        message: "上传失败，请稍后重试",
      },
      500
    );
  }
});

// 列出所有图片（支持分页）
imagesRoute.get("/", async (c) => {
  try {
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const cursor = c.req.query("cursor") || undefined;

    const listResult = await c.env.IMAGE_BUCKET.list({
      limit: Math.min(limit, 1000),
      cursor: cursor || undefined,
    });

    const baseUrl = new URL(c.req.url);

    const images = await Promise.all(
      listResult.objects.map(async (obj) => {
        const imageUrl = `${baseUrl.origin}/api/images/view/${obj.key}`;

        let imagesUrl: string | undefined;
        if (c.env.CF_ACCOUNT_HASH) {
          imagesUrl = buildImagesUrl(c.env.CF_ACCOUNT_HASH, obj.key, "thumbnail");
        }

        return {
          key: obj.key,
          size: obj.size,
          uploadedAt: obj.uploaded,
          url: imageUrl,
          imagesUrl,
          customMetadata: obj.customMetadata,
        };
      })
    );

    return c.json({
      success: true,
      data: {
        images,
        cursor: listResult.truncated
          ? (listResult as { cursor: string }).cursor
          : undefined,
        truncated: listResult.truncated,
      },
    });
  } catch (error) {
    console.error("列出图片失败:", error);
    return c.json(
      {
        success: false,
        message: "获取图片列表失败",
      },
      500
    );
  }
});

// 删除图片
imagesRoute.delete("/:key{.+}", async (c) => {
  try {
    const key = c.req.param("key");

    // 检查文件是否存在
    const object = await c.env.IMAGE_BUCKET.head(key);
    if (!object) {
      return c.json(
        {
          success: false,
          message: "图片不存在",
        },
        404
      );
    }

    // 删除文件
    await c.env.IMAGE_BUCKET.delete(key);

    return c.json({
      success: true,
      message: "删除成功",
      data: {
        key,
        deletedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("删除图片失败:", error);
    return c.json(
      {
        success: false,
        message: "删除失败",
      },
      500
    );
  }
});

// 获取图片信息
imagesRoute.get("/info/:key{.+}", async (c) => {
  try {
    const key = c.req.param("key");

    const object = await c.env.IMAGE_BUCKET.head(key);

    if (!object) {
      return c.json(
        {
          success: false,
          message: "图片不存在",
        },
        404
      );
    }

    const baseUrl = new URL(c.req.url);
    const imageUrl = `${baseUrl.origin}/api/images/view/${key}`;

    // 构建各种变体的 Images URL
    const variants: Record<string, string> = {};
    if (c.env.CF_ACCOUNT_HASH) {
      variants.public = buildImagesUrl(c.env.CF_ACCOUNT_HASH, key, "public");
      variants.thumbnail = buildImagesUrl(c.env.CF_ACCOUNT_HASH, key, "thumbnail");
    }

    return c.json({
      success: true,
      data: {
        key: object.key,
        size: object.size,
        etag: object.httpEtag,
        uploadedAt: object.uploaded,
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        url: imageUrl,
        variants,
      },
    });
  } catch (error) {
    console.error("获取图片信息失败:", error);
    return c.json(
      {
        success: false,
        message: "获取图片信息失败",
      },
      500
    );
  }
});

export { imagesRoute };
