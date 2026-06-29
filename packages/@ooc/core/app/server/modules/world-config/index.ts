/**
 * world-config module — server module for world-level config (S8, 2026-06-29)。
 *
 * 设计权威: knowledge/startup-constraints + `<baseDir>/.world.json`。
 *
 * 当前 endpoint:
 *   GET /api/world/config — 读 <baseDir>/.world.json (缺则空对象 + 默认)
 *
 * 留 follow-up:
 *   PUT /api/world/config — 修改 .world.json (含三层 path 防护)
 */
import { Elysia } from "elysia";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WorldConfigModuleConfig {
  baseDir: string;
}

interface WorldConfig {
  siteName?: string;
  /** 飞书 lark 配置, 用于 FeishuDocWindowDetail 拼可点击链接。 */
  lark?: {
    feishuPrefix?: string;
  };
  /** stones-versioning escape (允许写 stones/main 外的文件)。 */
  allowEscapeWorldFilePathLimit?: boolean;
  prAutoMerge?: boolean;
  /** 其他自定义字段 — 不解析,透传。 */
  [key: string]: unknown;
}

const DEFAULT_CONFIG: WorldConfig = {
  siteName: "Oriented Object Context",
  prAutoMerge: false,
};

export function buildWorldConfigModule(config: WorldConfigModuleConfig) {
  const { baseDir } = config;
  return new Elysia({ prefix: "/api/world" })
    .get(
      "/config",
      async () => {
        const path = join(baseDir, ".world.json");
        try {
          const raw = await readFile(path, "utf8");
          const parsed = JSON.parse(raw) as WorldConfig;
          return { ...DEFAULT_CONFIG, ...parsed };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_CONFIG;
          // JSON parse 失败也返默认 (避免 server crash)
          console.warn(`[world-config] read failed: ${(e as Error).message}`);
          return DEFAULT_CONFIG;
        }
      },
    );
}
