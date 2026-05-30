// src/app/server/bootstrap/builtin-seed.ts
/**
 * 8 个 builtin 原型的 seed（OOC-4 L3）。
 *
 * _builtin 原型是框架派生投影：ensureBuiltinObjects 每启动从这里覆盖式重生
 * stones/_builtin/objects/<name>/。L3 只物化骨架（self.md 建立 extends 链 +
 * root 的兜底 readable.md）；window behavior（executable commands / 真实 readable /
 * visible）由 L4/L8 转写。
 *
 * 权威：docs/superpowers/specs/2026-05-30-ooc-4-incremental-object-unification-design.md §3.2。
 */

/** 单个 builtin 原型的 seed。 */
export interface BuiltinPrototypeSeed {
  /** 原型名 = objectId（stones/_builtin/objects/<name>）。 */
  name: string;
  /** self.md frontmatter extends 原始值：null=链终点（仅 root）；"root"=继承 root。 */
  extends: string | null;
  /** self.md body（frontmatter 之后的正文）。 */
  self: string;
  /** 非空才 writeReadable；省略=留空占位（沿链兜底）。 */
  readable?: string;
}

export const BUILTIN_ROOT_NAME = "root";

/** 8 原型（root + 7 个 A 类实体），spec §3.2。顺序无关，root 不必排首。 */
export const BUILTIN_PROTOTYPES: ReadonlyArray<BuiltinPrototypeSeed> = [
  {
    name: "root",
    extends: null,
    self: "OOC-4 root 原型：所有 Object 的原型链终点。方法 / visible / readable 沿 extends 链向上找不到时由 root 兜底。",
    readable:
      "root 原型（OOC-4 prototype chain 兜底）。任何未自定义对外展示的 Object 最终落到这里。",
  },
  { name: "program", extends: BUILTIN_ROOT_NAME, self: "OOC-4 program 原型：代码执行实体（A 类）。behavior 由 L4 转写自 windows/program。" },
  { name: "search", extends: BUILTIN_ROOT_NAME, self: "OOC-4 search 原型：搜索/探索实体（A 类）。behavior 由 L4 转写自 windows/search。" },
  { name: "file", extends: BUILTIN_ROOT_NAME, self: "OOC-4 file 原型：文件实体（A 类）。behavior 由 L4 转写自 windows/file。" },
  { name: "knowledge", extends: BUILTIN_ROOT_NAME, self: "OOC-4 knowledge 原型：知识展示实体（A 类）。behavior 由 L4 转写自 windows/knowledge。" },
  { name: "command_exec", extends: BUILTIN_ROOT_NAME, self: "OOC-4 command_exec 原型：命令表单实体（A 类）。behavior 由 L4 转写自 windows/command_exec。" },
  { name: "skill_index", extends: BUILTIN_ROOT_NAME, self: "OOC-4 skill_index 原型：技能索引实体（A 类）。behavior 由 L4 转写自 windows/skill_index。" },
  { name: "custom", extends: BUILTIN_ROOT_NAME, self: "OOC-4 custom 原型：用户自定义 Object 实体（A 类）。behavior 由 L4 转写自 windows/custom。" },
];

/** 把 seed 拼成 self.md 全文（frontmatter + body）。extends=null → YAML `null`。 */
export function buildSelfMd(seed: BuiltinPrototypeSeed): string {
  const ext = seed.extends === null ? "null" : seed.extends;
  return `---\nextends: ${ext}\n---\n${seed.self}\n`;
}
