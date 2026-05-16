import * as search from "@src/executable/windows/search";

/**
 * search_window 概念：把一次 glob / grep 的结果以持久 window 形式留在 context。
 *
 * sources:
 *  - search — close / open_match 命令注册 + basicKnowledge
 */
export const search_window_v20260516_1 = {
  name: "SearchWindow",
  description: `
search_window 是一次 glob 或 grep 搜索的结果窗口，由 \`root.glob\` 或 \`root.grep\` 直建。

它解决"搜索结果是 LLM 自己 re-parse 一段 shell stdout"的痛点——把每条命中表示成一个
带稳定 \`index\` 的对象，LLM 可以通过 \`open_match(index)\` 直接 spawn 一个 file_window
打开命中文件，不需要从裸文本里解析路径。

注册的命令：
- open_match — 在指定 match 的 path 上 spawn file_window
  - grep kind 时 file_window 自动使用 [line ± 40] 切片
- close — 释放本搜索窗口

字段：
- kind: "glob" | "grep" — 区分搜索类型；同一 type 复用渲染与 open_match
- query: 触发本次搜索的 pattern / regex
- matches: 命中数组（每条带稳定 index + path；grep 还有 line + snippet）
- truncated: 是否被 200 上限截断
- searchRoot: 搜索的根目录（便于理解 match.path 的相对性）

关键约束：search_window 不持有可被 LLM mutate 的状态——想换条件就 open(command="glob"|"grep")
重新搜，本期不提供 next_page / refine_query。
`.trim(),
  sources: { search },
};
