/**
 * 评论数据类型定义
 */

export interface Comment {
  id: number;
  slug: string;
  parent_id: number | null;
  author_name: string;
  author_email: string | null;
  author_website: string | null;
  content: string;
  status: 'pending' | 'approved' | 'spam';
  created_at: string;
  updated_at: string;
}

export interface CommentWithReplies extends Comment {
  replies?: CommentWithReplies[];
  avatar_url?: string;
}

export interface CreateCommentInput {
  author_name: string;
  author_email?: string;
  author_website?: string;
  content: string;
  parent_id?: number;
}

export interface CommentListResponse {
  comments: CommentWithReplies[];
  total: number;
}

export interface CommentSubmitResponse {
  success: boolean;
  message: string;
  comment?: Comment;
}

/**
 * 图片上传相关类型定义
 */

export interface UploadedFile {
  key: string;
  originalName: string;
  size: number;
  contentType: string;
  url: string;
  markdown: string;
  imagesUrl?: string;
}

export interface ImageUploadResponse {
  success: boolean;
  message: string;
  data?: {
    uploaded: UploadedFile[];
    errors?: Array<{ filename: string; message: string }>;
  };
}

export interface ImageListItem {
  key: string;
  size: number;
  uploadedAt: string;
  url: string;
  imagesUrl?: string;
  customMetadata?: Record<string, string> | undefined;
}

export interface ImageListResponse {
  success: boolean;
  data?: {
    images: ImageListItem[];
    cursor?: string;
    truncated: boolean;
  };
  message?: string;
}

export interface ImageDeleteResponse {
  success: boolean;
  message: string;
  data?: {
    key: string;
    deletedAt: string;
  };
}

export interface ImageInfoResponse {
  success: boolean;
  data?: {
    key: string;
    size: number;
    etag: string;
    uploadedAt: string;
    httpMetadata?: Record<string, string>;
    customMetadata?: Record<string, string> | undefined;
    url: string;
    variants: Record<string, string>;
  };
  message?: string;
}
