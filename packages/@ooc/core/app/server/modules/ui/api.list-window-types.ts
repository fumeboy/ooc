/**
 * GET /api/windows/_shared/types — 列出所有已注册 window type 与其上的 commands。
 * GET /api/objects/_shared/types — 别名(2026-05-28 ooc-6 Object Unification):window 语义
 *   正在被 object 语义替代,两个路径返回相同内容。新代码优先使用 /api/objects/_shared/types。
 *
 * 用途:前端 WindowDetail 想展示某 window type 上能用的 command 清单(每个 type 不同),
 * 一次性拉到 catalog 后客户端按 type 索引即可,无需每次 getThread 都嵌入。
 *
 * 数据来源:src/executable/windows/_shared/registry.ts 里 registerObjectType 注入的 commands,
 * 加上 root window 的 ROOT_METHODS。两边都是静态注册,服务启动后不变。
 *
 * 每条 command 的 description:从 `entry.knowledge({}, "open")` 取 `*_BASIC` 路径的值
 * (按"path 以 /basic 结尾"约定挑;不命中时退化为返回值最长的那条)。description 是
 * 完整 markdown,前端 hover 时可截断后展示。
 */

import { Elysia } from "elysia";
import { builtinRegistry } from "../../../../executable/windows";
import { extractBasicDescription } from "../../../../executable/windows/_shared/method-description.js";

export type ObjectMethodEntry = {
  name: string;
  /** method.knowledge({}, "open") 中 *_BASIC 路径的 markdown 全文;无知识入口时 omit。 */
  description?: string;
};

export type ObjectTypeCatalogEntry = {
  type: string;
  /** 该 type 上注册的 method 列表(按 name 排序);空数组合法(例如 todo)。 */
  methods: ObjectMethodEntry[];
  /** type-level basicKnowledge 的简短摘要(取首段或前 200 字符);未注册则 omit。 */
  basicKnowledgeSummary?: string;
};

export function listObjectTypesApi() {
  const handler = (): { items: ObjectTypeCatalogEntry[] } => {
    const types = builtinRegistry.listRegisteredObjectTypes();
    const items: ObjectTypeCatalogEntry[] = types.map((type) => {
      const def = builtinRegistry.getObjectDefinition(type as never);
      const methods: ObjectMethodEntry[] = Object.entries(def.methods)
        .map(([name, entry]) => {
          const description = extractBasicDescription(entry);
          const out: ObjectMethodEntry = { name };
          if (description) out.description = description;
          return out;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      const out: ObjectTypeCatalogEntry = { type, methods };
      if (def.basicKnowledge) {
        out.basicKnowledgeSummary = summarize(def.basicKnowledge);
      }
      return out;
    });
    return { items };
  };

  return new Elysia({ name: "ooc.windows.api.list-types" })
    .get("/windows/_shared/types", handler)
    .get("/objects/_shared/types", handler);
}

function summarize(text: string, max = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
