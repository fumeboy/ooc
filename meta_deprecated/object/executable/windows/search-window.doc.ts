import type { Concept, DocNode } from "@meta/doc-types";
import * as search from "@src/executable/windows/search";

/**
 * search_window 概念：把一次 glob / grep 的结果以持久 window 形式留在 context。
 *
 * sources:
 *  - search — close / open_match 命令注册 + basicKnowledge + match → file_window spawn
 */
export type SearchWindowConcept = Concept & {
  sources: { search: typeof search };

  /** 5 个字段（kind / query / matches / truncated / searchRoot） */
  fields: {
    title: string;
    summary?: string;
    /** "glob" | "grep" 区分搜索类型 */
    kind: DocNode;
    /** 触发本次搜索的 pattern / regex */
    query: DocNode;
    /** 命中数组（含 index / path，grep 多带 line + snippet） */
    matches: DocNode;
    /** matches 超 200 上限时为 true */
    truncated: DocNode;
    /** 搜索根目录，open_match 用于解析相对路径 */
    searchRoot: DocNode;
  };

  /** 不可变性：window 不持有可被 mutate 的状态 */
  immutability: DocNode;

  /** 2 个命令（open_match 含子节点 / close） */
  commands: {
    title: string;
    summary?: string;
    /** 在指定 match 对应路径上 spawn file_window */
    openMatch: {
      title: string;
      summary?: string;
      /** executeSearchOpenMatch 的 5 步算法 */
      spawnAlgorithm: DocNode;
      /** index 缺失时的 input knowledge */
      inputKnowledge: DocNode;
      /** FILE_WINDOW_LINE_CONTEXT = 40 */
      lineContextConstant: DocNode;
    };
    close: DocNode;
  };

  /** basicKnowledge 注入：4 条提醒 */
  basicKnowledge: {
    title: string;
    summary?: string;
    /** matches 上限 200 截断 */
    truncate200: DocNode;
    /** 翻页 / 改 query 走新建 search_window */
    noRefineNewSearch: DocNode;
    /** grep kind 携带 line + snippet */
    grepLineSnippet: DocNode;
    /** grep open_match ±40 行切片 */
    grepOpenMatchSlice: DocNode;
  };
};

export const search_window_v20260516_1: SearchWindowConcept = {
  name: "SearchWindow",
  sources: { search },
  description: `
search_window 是一次 glob 或 grep 搜索的结果窗口，由 root.glob / root.grep 直建；
把每条命中表示成带稳定 index 的对象，避免 LLM 从裸 stdout 解析路径。
`.trim(),

  fields: {
    title: "字段",
    summary: "search_window 的 5 个字段（kind/query/matches/truncated/searchRoot）",

    kind: {
      title: "kind",
      content: `
"glob" | "grep" — 区分搜索类型。同一 type 复用渲染与 open_match；
但 grep kind 的 match 多带 line + snippet，影响 open_match 的 file_window 切片策略。
      `.trim(),
    },

    query: {
      title: "query",
      content: "触发本次搜索的 pattern / regex；只读，不能被 mutate。",
    },

    matches: {
      title: "matches",
      content: `
命中数组；每条结构：

- index — 稳定整数（open_match 通过它定位）
- path — 命中文件路径（可能绝对或 searchRoot 相对）
- line / snippet — 仅 grep kind 存在
      `.trim(),
    },

    truncated: {
      title: "truncated",
      content: "matches 超过 200 上限时为 true，提示 LLM 用更精确 query 重新搜。",
    },

    searchRoot: {
      title: "searchRoot",
      content: "搜索的根目录；open_match 中用它解析 match.path 的相对路径。",
    },
  },

  immutability: {
    title: "不可变性",
    summary: "创建后字段定型，不提供 next_page / refine_query",
    content: `
search_window 不持有可被 LLM mutate 的状态：query / matches / kind 在创建时定型。
想换条件就 open(command="glob"|"grep") 重新搜；不提供 next_page / refine_query。
    `.trim(),
  },

  commands: {
    title: "命令面",
    summary: "search_window 注册 2 个 command",

    openMatch: {
      title: "open_match",
      summary: "在 match 对应路径上 spawn file_window",

      spawnAlgorithm: {
        title: "spawnAlgorithm（executeSearchOpenMatch）",
        content: `
1. 校验：parentWindow 必须是 type=search；按 args.index 在 matches 中查找
2. 路径解析：match.path 绝对则原样；否则 resolve(searchRoot ?? process.cwd(), match.path)
3. lines 切片：grep kind 且 match.line 存在时 → [max(0, line-40), line+40]；
   glob kind → undefined（整体打开）
4. 通过 manager.insertTypedWindow 新建 file_window 挂在 ROOT_WINDOW_ID 下
5. search_window 自身不变（不"消费"该 match），可重复 open_match
        `.trim(),
      },

      inputKnowledge: {
        title: "inputKnowledge",
        content: `
formStatus==="open" 且 typeof args.index !== "number" 时，knowledge 表追加 key
internal/windows/search/open_match/input，提示 args={ index: <整数> }。
        `.trim(),
      },

      lineContextConstant: {
        title: "lineContextConstant",
        content: "FILE_WINDOW_LINE_CONTEXT = 40 — grep open_match 时 file_window 默认 lines 切片半径。",
      },
    },

    close: {
      title: "close",
      content: `
释放本搜索窗口；不影响任何 match 对应的文件。exec 体 no-op；释放由 WindowManager 完成。
      `.trim(),
    },
  },

  basicKnowledge: {
    title: "basic knowledge 注入",
    summary: "通过 registerWindowType 注入的 4 条提醒",

    truncate200: {
      title: "truncate200",
      content: "matches 超过 200 条时截断，set search_window.truncated=true 提示 LLM 用更精确 query 重新搜。",
    },

    noRefineNewSearch: {
      title: "noRefineNewSearch",
      content: "翻页 / 改 query 都通过新建 search_window，不提供 next_page / refine_query；与 immutability 约束一致。",
    },

    grepLineSnippet: {
      title: "grepLineSnippet",
      content: "grep kind 的每条 match 带 line + snippet（单行 trim 200 字符），glob kind 没有这两字段。",
    },

    grepOpenMatchSlice: {
      title: "grepOpenMatchSlice",
      content: "open_match grep 自动 ±40 行切片（FILE_WINDOW_LINE_CONTEXT 常量），glob open_match 整体打开。",
    },
  },
};
