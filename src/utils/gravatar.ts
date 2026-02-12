/**
 * Gravatar 头像生成
 */

const GRAVATAR_BASE_URL = "https://www.gravatar.com/avatar";

/**
 * 生成 Gravatar URL
 * @param email - 邮箱地址
 * @param size - 头像大小（默认 48）
 * @param defaultImage - 默认头像（默认 identicon）
 */
export function getGravatarUrl(
  email: string | null | undefined,
  size: number = 48,
  defaultImage: string = "identicon"
): string {
  if (!email) {
    return `${GRAVATAR_BASE_URL}?d=${defaultImage}&s=${size}`;
  }

  // 生成 MD5 hash
  const hash = email.toLowerCase().trim();
  return `${GRAVATAR_BASE_URL}/${hash}?d=${defaultImage}&s=${size}`;
}
