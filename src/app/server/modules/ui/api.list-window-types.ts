/**
 * GET /api/windows/types — 列出所有已注册 window type 与其上的 commands。
 *
 * 用途:前端 WindowDetail 想展示某 window type 上能用的 command 清单(每个 type 不同),
 * 一次性拉到 catalog 后客户端按 type 索引即可,无需每次 getThread 都嵌入。
 *
 * 数据来源:src/executable/windows/_shared/registry.ts 里 registerWindowType 注入的 commands,
 * 加上 root window 的 ROOT_COMMANDS。两边都是静态注册,服务启动后不变。
 *
 * 每条 command 的 description:从 `entry.knowledge({}, "open")` 取 `*_BASIC` 路径的值
 * (按"path 以 /basic 结尾"约定挑;不命中时退化为返回值最长的那条)。description 是
 * 完整 markdown,前端 hover 时可截断后展示。
 */

import { Elysia } from "elysia";
import {
  getWindowTypeDefinition,
  listRegisteredWindowTypes,
} from "../../../../executable/windows";
import type { CommandTableEntry } from "../../../../executable/windows";

export type WindowCommandEntry = {
  name: string;
  /** command.knowledge({}, "open") 中 *_BASIC 路径的 markdown 全文;无知识入口时 omit。 */
  description?: string;
};

export type WindowTypeCatalogEntry = {
  type: string;
  /** 该 type 上注册的 command 列表(按 name 排序);空数组合法(例如 todo)。 */
  commands: WindowCommandEntry[];
  /** type-level basicKnowledge 的简短摘要(取首段或前 200 字符);未注册则 omit。 */
  basicKnowledgeSummary?: string;
};

export function listWindowTypesApi() {
  return new Elysia({ name: "ooc.windows.api.list-types" }).get(
    "/windows/_shared/types",
    (): { items: WindowTypeCatalogEntry[] } => {
      const types = listRegisteredWindowTypes();
      const items: WindowTypeCatalogEntry[] = types.map((type) => {
        const def = getWindowTypeDefinition(type);
        const commands: WindowCommandEntry[] = Object.entries(def.commands)
          .map(([name, entry]) => {
            const description = extractBasicDescription(entry);
            const out: WindowCommandEntry = { name };
            if (description) out.description = description;
            return out;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        const out: WindowTypeCatalogEntry = { type, commands };
        if (def.basicKnowledge) {
          out.basicKnowledgeSummary = summarize(def.basicKnowledge);
        }
        return out;
      });
      return { items };
    },
  );
}

/**
 * 从 command.knowledge({}, "open") 中挑出"基础描述":
 *   1. path 以 `/basic` 结尾的那条(约定;EDIT_KNOWLEDGE / KNOWLEDGE 都登记在这里)
 *   2. 兜底取返回值最长的那条(input hint 通常更短)
 *   3. knowledge 调用抛错 → 返回 undefined,让 UI 退化成"只有 chip 名"
 */
function extractBasicDescription(entry: CommandTableEntry): string | undefined {
  if (!entry.knowledge) return undefined;
  let map: Record<string, string>;
  try {
    map = entry.knowledge({}, "open") ?? {};
  } catch {
    return undefined;
  }
  const pairs = Object.entries(map).filter(
    (pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].length > 0,
  );
  if (pairs.length === 0) return undefined;
  const basic = pairs.find(([path]) => path.endsWith("/basic"));
  if (basic) return basic[1];
  // tie-break:取最长的
  return pairs.reduce((a, b) => (a[1].length >= b[1].length ? a : b))[1];
}

function summarize(text: string, max = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}
