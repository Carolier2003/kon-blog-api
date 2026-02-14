import { Hono } from "hono";
import type { Env } from "../index";

// 贡献数据结构
interface ContributionDay {
  date: string;
  count: number;
  githubCount: number;
  gitcodeCount: number;
  level: 0 | 1 | 2 | 3 | 4;
}

interface ContributionResponse {
  weeks: ContributionDay[][];
  total: number;
  githubTotal: number;
  gitcodeTotal: number;
  updatedAt: string;
}

// GitHub GraphQL API 响应类型
interface GitHubContributionCalendar {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          weeks: Array<{
            contributionDays: Array<{
              date: string;
              contributionCount: number;
            }>;
          }>;
        };
      };
    };
  };
}

// GitCode API 响应类型（根据实际响应调整）
interface GitCodeContribution {
  date?: string;
  count?: number;
  [key: string]: unknown;
}

// 创建路由
const app = new Hono<{ Bindings: Env }>();

/**
 * 从 GitHub GraphQL API 获取贡献数据
 */
async function fetchGitHubContributions(
  token: string,
  username: string
): Promise<Map<string, number>> {
  // Calculate date range for past 52 weeks
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 52 * 7);

  const from = startDate.toISOString();
  const to = today.toISOString();

  const query = `
    query {
      user(login: "${username}") {
        contributionsCollection(from: "${from}", to: "${to}") {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "kon-blog-api/1.0",
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = (await response.json()) as GitHubContributionCalendar;
  const contributions = new Map<string, number>();

  const weeks = data.data?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
  for (const week of weeks) {
    for (const day of week.contributionDays) {
      contributions.set(day.date, day.contributionCount);
    }
  }

  return contributions;
}

/**
 * 从 GitCode API 获取贡献数据
 */
async function fetchGitCodeContributions(username: string): Promise<Map<string, number>> {
  const url = `https://web-api.gitcode.com/uc/api/v1/events/${username}/contributions?username=${username}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Origin: "https://gitcode.com",
      Referer: "https://gitcode.com/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    // GitCode API 可能不稳定，失败时返回空数据
    console.warn(`GitCode API error: ${response.status}`);
    return new Map();
  }

  const data = await response.json() as Record<string, number> | GitCodeContribution[] | { data?: GitCodeContribution[] };
  const contributions = new Map<string, number>();

  // GitCode 返回的是字典格式: { "2025-02-14": 0, "2025-02-15": 1, ... }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    // 检查是否是字典格式（键是日期字符串）
    for (const [key, value] of Object.entries(data)) {
      // 只处理看起来像日期的键 (YYYY-MM-DD)
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        contributions.set(key, typeof value === "number" ? value : 0);
      }
    }
  }

  // 如果是数组格式（备用处理）
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.date) {
        const date = item.date.split("T")[0];
        contributions.set(date, item.count || 0);
      }
    }
  }

  // 如果是 { data: [...] } 格式（备用处理）
  if (data && typeof data === "object" && "data" in data && Array.isArray(data.data)) {
    for (const item of data.data) {
      if (item.date) {
        const date = item.date.split("T")[0];
        contributions.set(date, item.count || 0);
      }
    }
  }

  return contributions;
}

/**
 * 合并 GitHub 和 GitCode 的贡献数据
 */
function mergeContributions(
  githubData: Map<string, number>,
  gitcodeData: Map<string, number>
): Map<string, { count: number; github: number; gitcode: number }> {
  const merged = new Map<string, { count: number; github: number; gitcode: number }>();
  const allDates = new Set([...githubData.keys(), ...gitcodeData.keys()]);

  for (const date of allDates) {
    const github = githubData.get(date) || 0;
    const gitcode = gitcodeData.get(date) || 0;
    merged.set(date, {
      count: github + gitcode,
      github,
      gitcode,
    });
  }

  return merged;
}

/**
 * 计算贡献等级 (0-4)，类似 GitHub 的算法
 */
function calculateLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  if (count <= 9) return 3;
  return 4;
}

/**
 * 生成 52 周的热力图数据
 */
function generateHeatmapData(
  mergedData: Map<string, { count: number; github: number; gitcode: number }>
): ContributionResponse {
  const weeks: ContributionDay[][] = [];
  const today = new Date();
  const endDate = new Date(today);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 52 * 7); // 52 周前

  let total = 0;
  let githubTotal = 0;
  let gitcodeTotal = 0;

  // 生成 52 周的数据
  for (let w = 0; w < 52; w++) {
    const week: ContributionDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + w * 7 + d);
      const dateStr = date.toISOString().split("T")[0];

      const data = mergedData.get(dateStr) || { count: 0, github: 0, gitcode: 0 };

      week.push({
        date: dateStr,
        count: data.count,
        githubCount: data.github,
        gitcodeCount: data.gitcode,
        level: calculateLevel(data.count),
      });

      total += data.count;
      githubTotal += data.github;
      gitcodeTotal += data.gitcode;
    }
    weeks.push(week);
  }

  return {
    weeks,
    total,
    githubTotal,
    gitcodeTotal,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 更新贡献数据缓存
 */
async function updateContributionsCache(env: Env): Promise<ContributionResponse> {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not configured");
  }

  // 并行获取两个平台的数据
  const [githubData, gitcodeData] = await Promise.all([
    fetchGitHubContributions(token, "Carolier2003"),
    fetchGitCodeContributions("Carolier"),
  ]);

  // 合并数据
  const mergedData = mergeContributions(githubData, gitcodeData);

  // 生成热力图数据
  const heatmapData = generateHeatmapData(mergedData);

  // 存入 KV，TTL 12 小时
  await env.VIEW_KV.put("contributions", JSON.stringify(heatmapData), {
    expirationTtl: 12 * 60 * 60,
  });

  return heatmapData;
}

// GET /api/contributions - 获取贡献数据
app.get("/", async (c) => {
  try {
    // 尝试从缓存获取
    const cached = await c.env.VIEW_KV.get("contributions");

    if (cached) {
      const parsed = JSON.parse(cached) as ContributionResponse;
      // 验证缓存数据完整性
      if (parsed.total !== null && parsed.total !== undefined) {
        // 添加 CDN 缓存头，缓存 1 小时， stale-while-revalidate 12 小时
        c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=43200");
        c.header("Vary", "Origin");
        return c.json({
          success: true,
          data: parsed,
          cached: true,
        });
      }
      // 缓存数据无效，重新获取
      console.warn("Cached data invalid, refreshing...");
    }

    // 缓存未命中或无效，实时获取
    const data = await updateContributionsCache(c.env);

    // 即使是新数据，也添加缓存头（虽然数据刚更新，但可以短暂缓存）
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=3600");
    c.header("Vary", "Origin");

    return c.json({
      success: true,
      data,
      cached: false,
    });
  } catch (error) {
    console.error("Failed to fetch contributions:", error);

    // 返回模拟数据作为降级方案
    const mockData = generateMockData();
    return c.json({
      success: true,
      data: mockData,
      cached: false,
      mock: true,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /api/contributions/refresh - 强制刷新数据
app.post("/refresh", async (c) => {
  try {
    const data = await updateContributionsCache(c.env);

    return c.json({
      success: true,
      data,
      message: "Contributions data refreshed successfully",
    });
  } catch (error) {
    console.error("Failed to refresh contributions:", error);
    return c.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to refresh contributions",
      },
      500
    );
  }
});

/**
 * 生成模拟数据（降级方案）
 */
function generateMockData(): ContributionResponse {
  const weeks: ContributionDay[][] = [];
  let total = 0;

  for (let w = 0; w < 52; w++) {
    const week: ContributionDay[] = [];
    for (let d = 0; d < 7; d++) {
      const count = Math.random() > 0.6 ? Math.floor(Math.random() * 12) + 1 : 0;
      week.push({
        date: new Date(Date.now() - (52 - w) * 7 * 24 * 60 * 60 * 1000 + d * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
        count,
        githubCount: count,
        gitcodeCount: 0,
        level: calculateLevel(count),
      });
      total += count;
    }
    weeks.push(week);
  }

  return {
    weeks,
    total,
    githubTotal: total,
    gitcodeTotal: 0,
    updatedAt: new Date().toISOString(),
  };
}

export default app;
