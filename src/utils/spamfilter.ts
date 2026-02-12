/**
 * 简单的垃圾评论过滤
 */

// 垃圾关键词列表
const SPAM_KEYWORDS = [
  "viagra",
  "casino",
  "poker",
  "lottery",
  "click here",
  "buy now",
  "make money",
  "earn extra cash",
  "weight loss",
  "diet pill",
  "credit card",
  "free gift",
  "act now",
  "limited time",
  "urgent",
  "winner",
  "congratulations",
];

// 可疑链接模式
const SUSPICIOUS_LINKS = /\[url=|http[s]?:\/\/.{0,10}bit\.ly|http[s]?:\/\/.{0,10}tinyurl/i;

interface SpamCheckResult {
  isSpam: boolean;
  reason?: string;
  score: number;
}

/**
 * 检查评论是否为垃圾内容
 */
export function checkSpam(content: string, authorName: string): SpamCheckResult {
  let score = 0;
  const lowerContent = content.toLowerCase();
  const lowerName = authorName.toLowerCase();

  // 检查垃圾关键词
  for (const keyword of SPAM_KEYWORDS) {
    if (lowerContent.includes(keyword)) {
      score += 2;
    }
  }

  // 检查可疑链接
  if (SUSPICIOUS_LINKS.test(content)) {
    score += 3;
  }

  // 检查链接数量（过多链接 = 垃圾）
  const linkCount = (content.match(/https?:\/\//g) || []).length;
  if (linkCount > 3) {
    score += linkCount;
  }

  // 检查内容长度（过短或过长）
  if (content.length < 5) {
    score += 1;
  }
  if (content.length > 5000) {
    score += 1;
  }

  // 检查是否全是链接
  const textWithoutLinks = content.replace(/https?:\/\/\S+/g, "").trim();
  if (textWithoutLinks.length < 10 && linkCount > 0) {
    score += 3;
  }

  // 判定阈值
  if (score >= 3) {
    return {
      isSpam: true,
      reason: "疑似垃圾内容",
      score,
    };
  }

  return { isSpam: false, score };
}
