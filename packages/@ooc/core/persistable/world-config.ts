/**
 * world-config — `<baseDir>/.world.json` 配置读取。
 *
 * 设计动机：
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
import { readFileSync } from "node:fs";
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
  /**
   * 飞书机器人凭证。配置后 OOC 启动 lark event-relay worker：通过 SDK ws 长连接接收
   * im.message.receive_v1 事件，反向触发 OOC session（详见 @ooc/builtins/feishu_app/event-relay）。
   * 缺省（任一字段为空）时不启动 relay。
   *
   * **安全**：larkAppSecret 是机密，不通过 GET /api/world/config 下发前端；
   *           前端只能拿到布尔标志 hasLarkBot。
   */
  larkAppId?: string;
  larkAppSecret?: string;
  /**
   * 单次 worker 调度允许推进的最大 tick 数。缺省时由 ServerConfig 兜底为 15。
   * 必须是正整数；非法值（非数字 / 非整数 / <=0）会被忽略并 console.warn。
   *
   * 与环境变量 `OOC_WORKER_MAX_TICKS` 的关系：env 优先级更高（dev 临时覆盖），
   * 本字段是项目级配置基线（运维默认）。详见 src/app/server/bootstrap/config.ts。
   */
  workerMaxTicks?: number;
  /**
   * feat-branch PR 合入闸：所有 reviewer approve 后是否自动合入。
   *   - true  → ready-to-merge 时立即合入 main（无人工介入）。
   *   - false → ready-to-merge 时 PR 留 open 标 approved，等人工经
   *             `POST /api/runtime/pr-issues/:id/resolve {decision:"merge"}` 落锤（human-in-the-loop）。
   * 缺省 false（更安全：默认要求人工确认）。非 boolean 值忽略并 console.warn。
   */
  prAutoMerge: boolean;
  /**
   * 豁免 data 原语（grep / glob / write_file / open_file / file_window.edit）的 world 根
   * 边界拦截（resolveSessionPath，persistable/session-path.ts）。
   *   - false（默认）→ `../` 相对逃逸 + world 外绝对路径一律拒绝（安全默认）。
   *   - true → 允许解析到 world 目录之外。仅用于把整个宿主仓库当 world 操作的自举场景
   *            （如 .ooc-world-meta submodule 需要读写父仓库源码）。
   * 缺省 false。非 boolean 值忽略并 console.warn。
   */
  allowEscapeWorldFilePathLimit: boolean;
}

/** 原始 JSON 形态（解析前；字段全 optional + 大小写兼容写法）。 */
interface RawWorldConfig {
  siteName?: unknown;
  SiteName?: unknown;
  externalSkillsDir?: unknown;
  ExternalSkillsDir?: unknown;
  larkTenantHost?: unknown;
  LarkTenantHost?: unknown;
  larkAppId?: unknown;
  LarkAppId?: unknown;
  larkAppSecret?: unknown;
  LarkAppSecret?: unknown;
  workerMaxTicks?: unknown;
  WorkerMaxTicks?: unknown;
  prAutoMerge?: unknown;
  PrAutoMerge?: unknown;
  allowEscapeWorldFilePathLimit?: unknown;
  AllowEscapeWorldFilePathLimit?: unknown;
}

/** prAutoMerge 缺省值：false（默认要求人工确认更安全，见 WorldConfig.prAutoMerge）。 */
const DEFAULT_PR_AUTO_MERGE = false;

/** allowEscapeWorldFilePathLimit 缺省值：false（默认拦截 world 外读写，见 WorldConfig）。 */
const DEFAULT_ALLOW_ESCAPE_WORLD_FILE_PATH_LIMIT = false;

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
 * 解析正整数字段：接受 number 或可转为 number 的 string；要求 Number.isInteger > 0。
 * 非法值返回 undefined 并 console.warn（便于运维定位 .world.json 配错）。
 */
function pickPositiveInt(
  raw: RawWorldConfig,
  filePath: string,
  ...keys: (keyof RawWorldConfig)[]
): number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined) continue;
    let n: number;
    if (typeof v === "number") {
      n = v;
    } else if (typeof v === "string" && v.trim().length > 0) {
      n = Number(v);
    } else {
      console.warn(
        `[world-config] ${filePath} field '${String(k)}' has unsupported type ${typeof v}; ignoring`,
      );
      return undefined;
    }
    if (!Number.isInteger(n) || n <= 0) {
      console.warn(
        `[world-config] ${filePath} field '${String(k)}' = ${JSON.stringify(v)} is not a positive integer; ignoring`,
      );
      return undefined;
    }
    return n;
  }
  return undefined;
}

/**
 * 解析 boolean 字段：接受 boolean，或 "true"/"false"（大小写不敏感）字符串。
 * 缺省（字段不存在）返回 fallback；非法值返回 fallback 并 console.warn。
 */
function pickBoolean(
  raw: RawWorldConfig,
  filePath: string,
  fallback: boolean,
  ...keys: (keyof RawWorldConfig)[]
): boolean {
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined) continue;
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (t === "true") return true;
      if (t === "false") return false;
    }
    console.warn(
      `[world-config] ${filePath} field '${String(k)}' = ${JSON.stringify(v)} is not a boolean; using ${fallback}`,
    );
    return fallback;
  }
  return fallback;
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
      const defaults = defaultWorldConfig();
      cacheSet(baseDir, defaults);
      return defaults;
    }
    throw err;
  }

  const config = parseWorldConfig(raw, filePath, baseDir);
  cacheSet(baseDir, config);
  return config;
}

/**
 * readWorldConfig 的同步版本：供 sync 热路径（resolveSessionPath 的边界拦截分支）按需读取。
 *
 * 复用同一 TTL 缓存——server 启动期已通过 async 路径填好缓存，运行时这里几乎总是命中。
 * 缓存未命中时同步读盘（仅 path 逃逸这一冷分支会触发），ENOENT / 解析失败回落默认值。
 */
export function readWorldConfigSync(baseDir: string): WorldConfig {
  const cached = cacheGet(baseDir);
  if (cached) return cached;

  const filePath = join(baseDir, WORLD_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const defaults = defaultWorldConfig();
      cacheSet(baseDir, defaults);
      return defaults;
    }
    throw err;
  }

  const config = parseWorldConfig(raw, filePath, baseDir);
  cacheSet(baseDir, config);
  return config;
}

/** 全默认 WorldConfig（文件缺失 / 解析失败 / 非对象时回落）。 */
function defaultWorldConfig(): WorldConfig {
  return {
    siteName: DEFAULT_SITE_NAME,
    larkTenantHost: DEFAULT_LARK_TENANT_HOST,
    prAutoMerge: DEFAULT_PR_AUTO_MERGE,
    allowEscapeWorldFilePathLimit: DEFAULT_ALLOW_ESCAPE_WORLD_FILE_PATH_LIMIT,
  };
}

/** 把 `.world.json` 原文解析为 WorldConfig；解析失败 / 非对象回落默认值。纯函数（不读缓存/不读盘）。 */
function parseWorldConfig(raw: string, filePath: string, baseDir: string): WorldConfig {
  let parsed: RawWorldConfig;
  try {
    parsed = JSON.parse(raw) as RawWorldConfig;
  } catch (err) {
    console.warn(
      `[world-config] ${filePath} JSON parse failed (${(err as Error).message}); falling back to defaults`,
    );
    return defaultWorldConfig();
  }

  if (!parsed || typeof parsed !== "object") {
    return defaultWorldConfig();
  }

  // 字段大小写兼容：user 指令里写的是 SiteName / ExternalSkillsDir / LarkTenantHost / LarkAppId / LarkAppSecret，
  // 但 JS 习惯 camelCase；两种都接受。
  const siteName = pickString(parsed, "siteName", "SiteName") ?? DEFAULT_SITE_NAME;
  const larkTenantHost =
    pickString(parsed, "larkTenantHost", "LarkTenantHost") ?? DEFAULT_LARK_TENANT_HOST;
  const externalSkillsDir = resolveExternalSkillsDir(
    parsed.externalSkillsDir ?? parsed.ExternalSkillsDir,
    baseDir,
  );
  const larkAppId = pickString(parsed, "larkAppId", "LarkAppId");
  const larkAppSecret = pickString(parsed, "larkAppSecret", "LarkAppSecret");
  const workerMaxTicks = pickPositiveInt(parsed, filePath, "workerMaxTicks", "WorkerMaxTicks");
  const prAutoMerge = pickBoolean(parsed, filePath, DEFAULT_PR_AUTO_MERGE, "prAutoMerge", "PrAutoMerge");
  const allowEscapeWorldFilePathLimit = pickBoolean(
    parsed,
    filePath,
    DEFAULT_ALLOW_ESCAPE_WORLD_FILE_PATH_LIMIT,
    "allowEscapeWorldFilePathLimit",
    "AllowEscapeWorldFilePathLimit",
  );

  const config: WorldConfig = { siteName, larkTenantHost, prAutoMerge, allowEscapeWorldFilePathLimit };
  if (externalSkillsDir) config.externalSkillsDir = externalSkillsDir;
  if (larkAppId) config.larkAppId = larkAppId;
  if (larkAppSecret) config.larkAppSecret = larkAppSecret;
  if (workerMaxTicks !== undefined) config.workerMaxTicks = workerMaxTicks;
  return config;
}
