import * as search from "@src/executable/windows/search";

/**
 * search_window 概念：把一次 glob / grep 的结果以持久 window 形式留在 context。
 *
 * sources:
 *  - search — close / open_match 命令注册 + basicKnowledge + match → file_window spawn
 */
export const search_window_v20260516_1 = {
  name: "SearchWindow",
  description: `search_window 是一次 glob 或 grep 搜索的结果窗口，由 root.glob / root.grep 直建；把每条命中表示成带稳定 index 的对象，避免 LLM 从裸 stdout 解析路径。`,
  sources: { search },

  fields_v20260517_1: {
    index: `search_window 的字段集合；详见各子节点。`,

    kind_v20260517_1: {
      index: `
#### kind

"glob" | "grep" — 区分搜索类型。同一 type 复用渲染与 open_match；
但 grep kind 的 match 多带 line + snippet，影响 open_match 的 file_window 切片策略。
`,
    },

    query_v20260517_1: {
      index: `#### query — 触发本次搜索的 pattern / regex；只读，不能被 mutate。`,
    },

    matches_v20260517_1: {
      index: `
#### matches

命中数组；每条结构：

- index — 稳定整数（open_match 通过它定位）
- path — 命中文件路径（可能绝对或 searchRoot 相对）
- line / snippet — 仅 grep kind 存在
`,
    },

    truncated_v20260517_1: {
      index: `#### truncated — matches 超过 200 上限时为 true，提示 LLM 用更精确 query 重新搜。`,
    },

    searchRoot_v20260517_1: {
      index: `#### searchRoot — 搜索的根目录；open_match 中用它解析 match.path 的相对路径。`,
    },
  },

  immutability_v20260517_1: {
    index: `
search_window 不持有可被 LLM mutate 的状态：query / matches / kind 在创建时定型。
想换条件就 open(command="glob"|"grep") 重新搜；不提供 next_page / refine_query。
`,
  },

  commands_v20260517_1: {
    index: `search_window 注册 2 个 command。`,

    openMatch_v20260517_1: {
      index: `
### open_match

在指定 match 对应的 path 上 spawn 一个 file_window。

参数：
- index: 必填整数；对应 matches[].index

调用：open(parent_window_id="<search_window_id>", command="open_match", args={ index: 2 })

执行算法见 open_match.spawnAlgorithm；缺 index 时 input knowledge 见 open_match.inputKnowledge。
`,

      spawnAlgorithm_v20260517_1: {
        index: `
#### spawnAlgorithm（executeSearchOpenMatch）

1. 校验：parentWindow 必须是 type=search；按 args.index 在 matches 中查找
2. 路径解析：match.path 绝对则原样；否则 resolve(searchRoot ?? process.cwd(), match.path)
3. lines 切片：grep kind 且 match.line 存在时 → [max(0, line-40), line+40]；
   glob kind → undefined（整体打开）
4. 通过 manager.insertTypedWindow 新建 file_window 挂在 ROOT_WINDOW_ID 下
5. search_window 自身不变（不"消费"该 match），可重复 open_match
`,
      },

      inputKnowledge_v20260517_1: {
        index: `
#### inputKnowledge

formStatus==="open" 且 typeof args.index !== "number" 时，knowledge 表追加 key
internal/windows/search/open_match/input，提示 args={ index: <整数> }。
`,
      },

      lineContextConstant_v20260517_1: {
        index: `
#### lineContextConstant

FILE_WINDOW_LINE_CONTEXT = 40 — grep open_match 时 file_window 默认 lines 切片半径。
`,
      },
    },

    close_v20260517_1: {
      index: `
### close

释放本搜索窗口；不影响任何 match 对应的文件。exec 体 no-op；释放由 WindowManager 完成。
`,
    },
  },

  basicKnowledge_v20260517_1: {
    index: `
通过 registerWindowType("search", { basicKnowledge: SEARCH_WINDOW_BASIC_KNOWLEDGE }) 注入；
只要 thread.contextWindows 里出现至少一个 search_window，全局基础知识合成阶段就把
这段文本作为一个 protocol KnowledgeWindow 注入到 context。覆盖 4 条提醒详见各子节点。
`,

    truncate200_v20260517_1: {
      index: `##### truncate200 — matches 超过 200 条时截断，set search_window.truncated=true 提示 LLM 用更精确 query 重新搜。`,
    },

    noRefineNewSearch_v20260517_1: {
      index: `##### noRefineNewSearch — 翻页 / 改 query 都通过新建 search_window，不提供 next_page / refine_query；与 immutability 约束一致。`,
    },

    grepLineSnippet_v20260517_1: {
      index: `##### grepLineSnippet — grep kind 的每条 match 带 line + snippet（单行 trim 200 字符），glob kind 没有这两字段。`,
    },

    grepOpenMatchSlice_v20260517_1: {
      index: `##### grepOpenMatchSlice — open_match grep 自动 ±40 行切片（FILE_WINDOW_LINE_CONTEXT 常量），glob open_match 整体打开。`,
    },
  },
};
