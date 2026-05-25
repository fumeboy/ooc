import { Elysia } from "elysia";
import { readWorldConfig } from "@src/persistable";
import type { ServerConfig } from "../../bootstrap/config";

/**
 * worldConfigModule — 暴露 World 级配置（读自 \`<baseDir>/.world.json\`）。
 *
 * 当前路由：
 *   GET /api/world/config → { siteName, hasExternalSkills }
 *
 * 设计取舍：
 * - siteName 公开下发（前端 Logo 渲染用）。
 * - externalSkillsDir 是绝对文件系统路径，不下发前端（防泄露宿主目录结构 + 前端无消费场景）；
 *   只用 hasExternalSkills 布尔位提示前端"已配置"，未来如需展示 N 个外部 skill 再加专门字段。
 * - 后端按需读 \`.world.json\`（带 10s TTL 缓存，见 persistable/world-config.ts）；
 *   不进 ServerConfig，因 ServerConfig 是启动期常量、world-config 想做到运行时可改。
 */

export function worldConfigModule(config: ServerConfig) {
  return new Elysia({ prefix: "/api/world", name: "ooc.world-config" }).get(
    "/config",
    async () => {
      const cfg = await readWorldConfig(config.baseDir);
      return {
        siteName: cfg.siteName,
        hasExternalSkills: Boolean(cfg.externalSkillsDir),
      };
    },
  );
}
