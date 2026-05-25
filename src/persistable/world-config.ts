/**
 * world-config — `<baseDir>/.world.json` 配置读取。
 *
 * 设计动机（2026-05-25 user 指令）：
 *   World 级配置文件，承载需要在 server 与前端之间共享、但又不属于 ServerConfig
 *   命令行 / 环境变量层的轻量字段。
 *
 * 当前字段：
 *   - siteName: 网页 Logo 下方显示的站名；默认 "Oriented Object Context"。
 *   - externalSkillsDir: 外部 skills 目录绝对路径；skill_index window 构造索引时
 *     会同时扫描这个目录（与 stones/<branch>/skills 与 object 级 skills 合并）。
 *     支持 `~` 起手与相对 baseDir 的路径写法；空值或目录不存在 → 视为未配置。
 *
 * 读取语义：
 *   - 文件缺失：返回默认值，不报错。
 *   - 文件存在但 JSON 解析失败：记录 console.warn，返回默认值（不阻断 server 启动）。
 *   - 文件存在但字段类型不对：跳过该字段，使用默认值。
 *   - 10s TTL 缓存（与 stone-skills 同 pattern；测试通过 clearWorldConfigCache）。
 *
 * 与 ServerConfig 的关系：ServerConfig 是 sync 启动期常量；world-config 是按需读
 * （server 跑起来后随时 reload）。两者不交叉：ServerConfig 持有 baseDir，下游消费
 * 方按需调 readWorldConfig(baseDir) 拿 site/skills 等。
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** 默认站名（与 web/src/shared/brand/MainLogo.tsx 历史硬编码一致）。 */
export const DEFAULT_SITE_NAME = "Oriented Object Context";

/**
 * 默认飞书租户 host（公网飞书）；私有部署 / 国际版需要在 .world.json 显式配置。
 * 用于 feishu_doc.share_link / attach_to_chat 派生可分享链接。
 */
export const DEFAULT_LARK_TENANT_HOST = "feishu.cn";

/** 配置文件名（World root 下）。 */
export const WORLD_CONFIG_FILENAME = ".world.json";

/**
 * World 配置（解析后；externalSkillsDir 已展开为绝对路径或 undefined）。
 */
export interface WorldConfig {
  /** 网页 Logo 下方站名；缺省值见 DEFAULT_SITE_NAME。 */
  siteName: string;
  /**
   * 外部 skills 目录绝对路径；未配置 / 空值 / 不存在时为 undefined。
   * 相对路径相对 baseDir 解析；`~` 起手展开为 \$HOME。
   */
  externalSkillsDir?: string;
  /**
   * 飞书租户 host，用于派生 share link（feishu_doc.share_link / attach_to_chat）。
   * 例：公网飞书 = "feishu.cn"（默认）；新加坡 / 公海版 = "bytedance.sg.larkoffice.com"；
   * 国际版 = "lark.com"。仅 host 段，不带 scheme 与路径。
   */
  larkTenantHost: string;
}

/** 原始 JSON 形态（解析前；字段全 optional + 大小写兼容 user 指令的 SiteName / ExternalSkillsDir 写法）。 */
interface RawWorldConfig {
  siteName?: unknown;
  SiteName?: unknown;
  externalSkillsDir?: unknown;
  ExternalSkillsDir?: unknown;
  larkTenantHost?: unknown;
  LarkTenantHost?: unknown;
}

interface CachedEntry {
  fetchedAt: number;
  config: WorldConfig;
}

const WORLD_CONFIG_CACHE_TTL_MS = 10_000;
const cache = new Map<string, CachedEntry>();

function cacheGet(baseDir: string): WorldConfig | undefined {
  const entry = cache.get(baseDir);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > WORLD_CONFIG_CACHE_TTL_MS) {
    cache.delete(baseDir);
    return undefined;
  }
  return entry.config;
}

function cacheSet(baseDir: string, config: WorldConfig): void {
  cache.set(baseDir, { fetchedAt: Date.now(), config });
}

/** 清空 world config 缓存（测试钩子）。 */
export function clearWorldConfigCache(): void {
  cache.clear();
}

/**
 * 把配置里的 externalSkillsDir 展开为绝对路径。
 *
 * - 空字符串 / 非字符串 → undefined
 * - `~` / `~/...` → 相对 \$HOME
 * - 相对路径 → 相对 baseDir
 * - 绝对路径 → 原样
 */
function resolveExternalSkillsDir(raw: unknown, baseDir: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  if (isAbsolute(trimmed)) return trimmed;
  return join(baseDir, trimmed);
}

function pickString(raw: RawWorldConfig, ...keys: (keyof RawWorldConfig)[]): string | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/**
 * 读取 `<baseDir>/.world.json`，返回解析 + 默认值填充后的 WorldConfig。
 *
 * 永不抛错（除非 fs 出现非 ENOENT 的硬故障，那应该让 server 异常感知）。
 */
export async function readWorldConfig(baseDir: string): Promise<WorldConfig> {
  const cached = cacheGet(baseDir);
  if (cached) return cached;

  const filePath = join(baseDir, WORLD_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const defaults: WorldConfig = { siteName: DEFAULT_SITE_NAME, larkTenantHost: DEFAULT_LARK_TENANT_HOST };
      cacheSet(baseDir, defaults);
      return defaults;
    }
    throw err;
  }

  let parsed: RawWorldConfig;
  try {
    parsed = JSON.parse(raw) as RawWorldConfig;
  } catch (err) {
    console.warn(
      `[world-config] ${filePath} JSON parse failed (${(err as Error).message}); falling back to defaults`,
    );
    const defaults: WorldConfig = { siteName: DEFAULT_SITE_NAME, larkTenantHost: DEFAULT_LARK_TENANT_HOST };
    cacheSet(baseDir, defaults);
    return defaults;
  }

  if (!parsed || typeof parsed !== "object") {
    const defaults: WorldConfig = { siteName: DEFAULT_SITE_NAME, larkTenantHost: DEFAULT_LARK_TENANT_HOST };
    cacheSet(baseDir, defaults);
    return defaults;
  }

  // 字段大小写兼容：user 指令里写的是 SiteName / ExternalSkillsDir / LarkTenantHost，
  // 但 JS 习惯 camelCase；两种都接受。
  const siteName = pickString(parsed, "siteName", "SiteName") ?? DEFAULT_SITE_NAME;
  const larkTenantHost =
    pickString(parsed, "larkTenantHost", "LarkTenantHost") ?? DEFAULT_LARK_TENANT_HOST;
  const externalSkillsDir = resolveExternalSkillsDir(
    parsed.externalSkillsDir ?? parsed.ExternalSkillsDir,
    baseDir,
  );

  const config: WorldConfig = externalSkillsDir
    ? { siteName, larkTenantHost, externalSkillsDir }
    : { siteName, larkTenantHost };
  cacheSet(baseDir, config);
  return config;
}
