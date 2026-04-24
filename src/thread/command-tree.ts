/**
 * 命令树（Command Tree）—— 三阶段 Trait 激活的 Process 阶段索引
 *
 * 用途：把 (toolName, args) 派生为一个「点分命令路径」（如 `talk.continue.relation_update`），
 * 再用这个路径去匹配 trait 的 command_binding.commands（冒泡匹配：父绑定匹配子路径）。
 *
 * 设计原则：
 * - 独立数据结构：不绑定在具体 tool 里，不让各 tool 自注册
 * - 硬编码 TypeScript const：简单/可追踪/可静态分析；未来可考虑改 YAML
 * - 每个节点可选 `_match(args)`：从当前层向下潜时读哪个字段 → 哪个子节点
 * - `_match` 返回 undefined/null/空串 或 返回的字符串不对应子节点 → 停止下潜
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第二部分-process过程
 */

/** 命令树节点（递归结构）。一个节点可同时是分支（有子节点）和叶子（无子节点）。 */
export interface CommandTreeNode {
  /**
   * 从当前节点向下潜的匹配函数。
   *
   * 返回值语义：
   * - 字符串：下一步要进入的子节点名
   * - null / undefined / 空串：停在当前节点
   *
   * 如果节点本身没有 `_match`，视为叶子，停止下潜。
   */
  _match?: (args: Record<string, unknown>) => string | null | undefined;
  /** 其余键是子节点名到子节点的映射 */
  [child: string]: unknown;
}

/**
 * 命令树定义（核心数据）
 *
 * 命令路径语义（参见 spec）：
 * - talk.this_thread_creator / talk.fork / talk.continue / talk.continue.relation_update / talk.continue.question_form
 * - open.command / open.path
 * - program.shell / program.ts
 * - submit.compact / submit.talk / ...（每个可 submit 的 command 型 form 一个子节点）
 *
 * 注意：submit 下挂哪些具体 command 子节点由本模块硬编码，随新增 command 演进手动维护。
 * 目前挂 compact / talk / think；未来按需扩展。
 */
export const COMMAND_TREE: Record<string, CommandTreeNode> = {
  talk: {
    _match: (args) => {
      if (args.target === "this_thread_creator") return "this_thread_creator";
      const ctx = args.context;
      if (typeof ctx !== "string" || !ctx) return undefined;
      return ctx;
    },
    this_thread_creator: {},
    fork: {},
    continue: {
      _match: (args) => {
        const type = args.type;
        if (typeof type !== "string" || !type) return undefined;
        return type;
      },
      relation_update: {},
      question_form: {},
    },
  },
  open: {
    _match: (args) => {
      /* command 优先于 path（两者同时出现时），保持与 open tool 的主用法一致 */
      if (typeof args.command === "string" && args.command) return "command";
      if (typeof args.path === "string" && args.path) return "path";
      return undefined;
    },
    command: {},
    path: {},
  },
  program: {
    _match: (args) => {
      const lang = args.language ?? args.lang;
      if (typeof lang !== "string" || !lang) return undefined;
      return lang;
    },
    shell: {},
    ts: {},
  },
  submit: {
    _match: (args) => {
      const c = args.command;
      if (typeof c !== "string" || !c) return undefined;
      return c;
    },
    compact: {},
    talk: {},
    think: {},
  },
};

/**
 * 从 (toolName, args) 派生点分命令路径
 *
 * 算法：
 * 1. 以 toolName 进入 COMMAND_TREE；若不存在 → 返回空串
 * 2. 拼接当前节点名到路径
 * 3. 若节点有 `_match`：调用得到 `childKey`；若 childKey 为空或不对应子节点 → 停
 * 4. 否则进入子节点重复步骤 2-3
 *
 * 边界：
 * - 任意 args 字段值非 string 时被视为"不下潜"
 * - `_match` 抛异常被吞，视为停止下潜
 *
 * @param toolName 顶层 tool 名称（open / submit / talk / program / think / ...）
 * @param args    tool 的参数对象
 * @returns 点分路径（例：talk.continue.relation_update）；toolName 未定义时返回空串
 */
export function deriveCommandPath(
  toolName: string,
  args: Record<string, unknown>,
): string {
  const root = COMMAND_TREE[toolName];
  if (!root) return "";

  const segments: string[] = [toolName];
  let node: CommandTreeNode = root;

  /* 沿命令树下潜，安全上限防止畸形定义成环 */
  const MAX_DEPTH = 16;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const matchFn = node._match;
    if (typeof matchFn !== "function") break;

    let childKey: string | null | undefined;
    try {
      childKey = matchFn(args);
    } catch {
      /* _match 抛异常：视为无法下潜 */
      break;
    }
    if (typeof childKey !== "string" || !childKey) break;

    const child = node[childKey];
    if (!child || typeof child !== "object") break;

    segments.push(childKey);
    node = child as CommandTreeNode;
  }

  return segments.join(".");
}

/**
 * 命令路径冒泡匹配
 *
 * 规则：binding 被视为"前缀匹配"——
 * - binding == path  → 命中
 * - binding + "." 是 path 的前缀 → 命中（父绑定匹配子路径）
 *
 * 举例：
 * - binding `"talk"` 命中 `talk` / `talk.fork` / `talk.continue.relation_update`
 * - binding `"talk.continue"` 命中 `talk.continue` / `talk.continue.relation_update` 但不命中 `talk.fork`
 *
 * @param path    deriveCommandPath 生成的路径
 * @param binding command_binding.commands 中的一个条目
 */
export function matchesCommandPath(path: string, binding: string): boolean {
  if (!path || !binding) return false;
  if (path === binding) return true;
  return path.startsWith(binding + ".");
}
