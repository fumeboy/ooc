/**
 * search_window — 把一次 glob / grep 的结果以持久 window 的形式留在 context。
 *
 * 设计要点：
 * - 由 root.glob / root.grep 直建（在 U4/U5 中接入；本文件目前提供 close 命令 + basicKnowledge，
 *   open_match 在 U4 的同一个 registerWindowType 调用中合并进来）
 * - kind 区分两种搜索；同一 type 复用渲染 / open_match
 * - matches 截断到 200；超过则 truncated=true
 *
 * 该 window 不持有可被 LLM mutate 的状态：query / matches 在创建时定型；想换条件
 * 重新 open(command="glob"|"grep") 即可。
 */

import type {
  CommandKnowledgeEntries,
  CommandTableEntry,
} from "./command-types.js";
import { registerWindowType } from "./registry.js";

export const SEARCH_WINDOW_BASIC_PATH = "internal/windows/search/basic";
export const SEARCH_WINDOW_CLOSE_BASIC = "internal/windows/search/close/basic";

export const SEARCH_WINDOW_BASIC_KNOWLEDGE = `
search_window 是一次 glob 或 grep 搜索的结果窗口，由 \`root.glob\` 或 \`root.grep\` 直建。

每条 match 有一个稳定的 \`index\`，可以通过

\`\`\`
open(parent_window_id="<search_window_id>", command="open_match", args={ index: <N> })
\`\`\`

在该 match 对应的文件上 spawn 一个 file_window，便于继续阅读 / 编辑。

| command    | 作用 |
|------------|------|
| open_match | 在指定 match 的 path 上 spawn 一个 file_window |
| close      | 释放本搜索窗口 |

提醒：
- search_window.matches 截断到 200 条；如果 \`truncated=true\` 表示有更多结果未显示，
  请通过更精确的 query 重新 \`root.glob\` / \`root.grep\`
- 想"翻页"或"改 query 重搜"目前都通过新建 search_window 完成，本期不提供 next_page / refine_query
- grep kind 的 match 带 line + snippet；glob kind 只带 path
`.trim();

const CLOSE_KNOWLEDGE = `
search_window.close 释放本搜索窗口；不影响任何 match 对应的文件。
`.trim();

const closeCommand: CommandTableEntry = {
  paths: ["close"],
  match: () => ["close"],
  knowledge: (): CommandKnowledgeEntries => ({
    [SEARCH_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE,
  }),
  // close 副作用统一在 WindowManager.close + onClose hook（无），exec 体本身 no-op
  exec: () => undefined,
};

registerWindowType("search", {
  commands: {
    close: closeCommand,
  },
  basicKnowledge: SEARCH_WINDOW_BASIC_KNOWLEDGE,
});
