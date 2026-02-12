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
