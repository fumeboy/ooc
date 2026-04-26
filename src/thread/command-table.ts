/**
 * 命令表（Command Table）—— 三阶段 Trait 激活的 Process 阶段索引
 *
 * 用途：把 (toolName, args) 派生为一组「点分命令路径」（如 ["talk", "talk.continue", "talk.fork"]），
 * 再用这些路径去精确匹配 trait 的 activates_on.paths。
 *
 * 设计原则：
 * - 扁平表：每个 entry 自包含，不嵌套子节点树
 * - match(args) 返回 string[]（多路径并行），独立维度互不干扰
 * - 父路径显式包含：match 总是把命令本身名称放入结果，无需前缀匹配
 * - openable: true：标记该命令可通过 open(type=command, command=X) 打开
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第二部分-process过程
 */

/** 命令表条目（扁平结构，无嵌套子节点）。 */
export interface CommandTableEntry {
  /** 该 command 可能产出的所有 path 集合（用于反向索引建表 + 文档目录） */
  paths: string[];
  /**
   * 给定 args，返回此次激活的 path 子集（必含 command 自身名）。多条路径并行。
   *
   * 规则：
   * - 总是包含 bare command 名（如 "talk"）
   * - 各维度（wait、context、type 等）独立决定是否追加对应 path
   * - match 抛异常时退化为只返回 bare path
   */
  match: (args: Record<string, unknown>) => string[];
  /** 是否可通过 open(type=command, command=X) 打开。用于 OPEN_TOOL.command.enum 的动态生成。 */
  openable?: boolean;
  /** 执行底层 command 的回调（可选；当前 engine 在分支里直接处理）。 */
  exec?: (args: Record<string, unknown>) => Promise<void> | void;
}

/**
 * 命令表定义（核心数据）
 *
 * 命令路径语义（参见 spec）：
 * - talk / talk.fork / talk.continue / talk.new / talk.wait
 * - talk.relation_update / talk.question_form
 * - talk.continue.relation_update / talk.continue.question_form
 * - think / think.fork / think.continue / think.wait
 * - open.command / open.path
 * - program.shell / program.ts
 * - submit.compact / submit.talk
 * - return（叶子）
 *
 * openable: true 的条目会出现在 OPEN_TOOL.command.enum（通过 getOpenableCommands() 动态生成）。
 */
export const COMMAND_TABLE: Record<string, CommandTableEntry> = {
  talk: {
    paths: [
      "talk", "talk.fork", "talk.continue", "talk.new", "talk.wait",
      "talk.relation_update", "talk.question_form",
      "talk.continue.relation_update", "talk.continue.question_form",
    ],
    match: (args) => {
      const hit: string[] = ["talk"];
      const ctx = typeof args.context === "string" ? args.context : "";
      const type = typeof args.type === "string" ? args.type : "";
      if (args.wait === true) hit.push("talk.wait");
      if (ctx === "fork") hit.push("talk.fork");
      if (ctx === "continue") hit.push("talk.continue");
      if (ctx === "new") hit.push("talk.new");
      if (type === "relation_update") {
        hit.push("talk.relation_update");
        if (ctx === "continue") hit.push("talk.continue.relation_update");
      }
      if (type === "question_form") {
        hit.push("talk.question_form");
        if (ctx === "continue") hit.push("talk.continue.question_form");
      }
      return hit;
    },
    openable: true,
  },

  think: {
    paths: ["think", "think.fork", "think.continue", "think.wait"],
    match: (args) => {
      const hit: string[] = ["think"];
      const ctx = typeof args.context === "string" ? args.context : "";
      if (args.wait === true) hit.push("think.wait");
      if (ctx === "fork") hit.push("think.fork");
      if (ctx === "continue") hit.push("think.continue");
      return hit;
    },
    openable: true,
  },

  program: {
    paths: ["program", "program.shell", "program.ts"],
    match: (args) => {
      const hit: string[] = ["program"];
      const lang = (args.language ?? args.lang) as string | undefined;
      if (lang === "shell") hit.push("program.shell");
      if (lang === "ts") hit.push("program.ts");
      return hit;
    },
    openable: true,
  },

  open: {
    paths: ["open", "open.command", "open.path"],
    match: (args) => {
      const hit: string[] = ["open"];
      if (typeof args.command === "string" && args.command) hit.push("open.command");
      if (typeof args.path === "string" && args.path) hit.push("open.path");
      return hit;
    },
    /* open 是元工具本身，不支持作为 open(type=command, command=X) 的目标 */
  },

  submit: {
    paths: ["submit", "submit.compact", "submit.talk"],
    match: (args) => {
      const hit: string[] = ["submit"];
      const c = typeof args.command === "string" ? args.command : "";
      if (c === "compact") hit.push("submit.compact");
      if (c === "talk") hit.push("submit.talk");
      return hit;
    },
  },

  return:        { paths: ["return"],        match: () => ["return"],        openable: true },
  refine:        { paths: ["refine"],        match: () => ["refine"] },
  close:         { paths: ["close"],         match: () => ["close"] },
  wait:          { paths: ["wait"],          match: () => ["wait"] },
  call_function: { paths: ["call_function"], match: () => ["call_function"], openable: true },
  set_plan:      { paths: ["set_plan"],      match: () => ["set_plan"],      openable: true },
  await:         { paths: ["await"],         match: () => ["await"],         openable: true },
  await_all:     { paths: ["await_all"],     match: () => ["await_all"],     openable: true },
  defer:         { paths: ["defer"],         match: () => ["defer"],         openable: true },
  compact:       { paths: ["compact"],       match: () => ["compact"],       openable: true },
};

/**
 * 返回所有 openable 命令的名称列表（已排序）
 *
 * 用于动态生成 OPEN_TOOL.command.enum，保持单一数据来源：
 * 新增 command 只需在 COMMAND_TABLE 里设置 openable: true，tools.ts 自动包含。
 */
export function getOpenableCommands(): string[] {
  return Object.keys(COMMAND_TABLE)
    .filter((key) => COMMAND_TABLE[key]?.openable === true)
    .sort();
}

/**
 * 从 (toolName, args) 派生此次激活的 path 集合（多路径并行）
 *
 * 算法：
 * 1. 以 toolName 在 COMMAND_TABLE 里查找 entry；若不存在 → 返回 []
 * 2. 调用 entry.match(args) 获取 path 列表
 * 3. match 抛异常时退化为 [toolName]
 *
 * @param toolName 顶层 tool 名称（open / submit / talk / program / return / ...）
 * @param args    tool 的参数对象
 * @returns 点分路径数组（例：["talk", "talk.continue", "talk.continue.relation_update"]）；toolName 未定义时返回 []
 */
export function deriveCommandPaths(
  toolName: string,
  args: Record<string, unknown>,
): string[] {
  const entry = COMMAND_TABLE[toolName];
  if (!entry) return [];
  try {
    return entry.match(args);
  } catch {
    /* match 抛异常时退化为只命中 bare path */
    return [toolName];
  }
}
