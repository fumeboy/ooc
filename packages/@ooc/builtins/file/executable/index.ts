/**
 * file_window — 在 context 中显示某个文件的内容窗口。
 *
 * - 由 root.open_file / root.write_file 创建（args: path, lines?, columns?）
 *   open 时自动填默认 viewport = 0-200 行 / 0-200 字符（DEFAULT_VIEWPORT）
 * - 注册的 method：set_viewport / set_range / reload / edit / close
 *   - **set_viewport（推荐）**：精细化调整渲染窗口（line_start/line_end/column_start/column_end）
 *   - set_range：遗留命令，调整 lines / columns 切片（保留向后兼容）
 *   - reload：重新读文件（render 层每轮都会读，所以 reload 主要是语义提示）
 *   - edit：基于"oldString → newString"做精确唯一替换；支持 array 形式做 atomic 多点修改
 *   - close：释放 window
 * - 渲染：viewport 控制行/列切片 + overflow marker；32KB 兜底截断
 *
 * 详见 meta/object.doc.ts:executable.context_window.patches.viewport_protocol。
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  MethodExecutionContext,
  ObjectMethod,
} from "@ooc/core/extendable/_shared/method-types.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import type { FileWindow } from "../types.js";
import { DEFAULT_VIEWPORT } from "@ooc/core/extendable/_shared/viewport.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
} from "@ooc/core/extendable/_shared/types.js";
import {
  classifyPackagesPath,
  relWithinObjectFromPackages,
  resolveSessionPath,
} from "@ooc/core/extendable/_shared/session-path.js";
import {
  sessionUsesWorktree,
  resolveStoneIdentityRef,
} from "@ooc/core/persistable/index.js";
import { stoneDir } from "@ooc/core/persistable/common.js";

import type { MethodExecWindow } from "@ooc/core/executable/windows/method_exec/types.js";
import { buildGuidanceWindows } from "@ooc/builtins/_shared/executable/guidance.js";
import { isString, basenameOfPath, emptyIntent, asTuple } from "@ooc/builtins/_shared/executable/utils.js";


const MAX_FILE_WINDOW_BYTES = 32768;

const FILE_WINDOW_RELOAD_BASIC = "internal/windows/file/reload/basic";
const FILE_WINDOW_CLOSE_BASIC = "internal/windows/file/close/basic";
const FILE_WINDOW_EDIT_BASIC = "internal/windows/file/edit/basic";
const FILE_WINDOW_EDIT_INPUT = "internal/windows/file/edit/input";

const RELOAD_KNOWLEDGE = `
file_window.reload 强制下一轮重新读文件。当前 render 每轮都重读一次，本命令主要是语义提示。
`.trim();

const CLOSE_KNOWLEDGE = `
file_window.close 释放 window；不影响磁盘上的文件本身。
`.trim();

const EDIT_KNOWLEDGE = `
file_window.edit 在 file_window 对应的文件上做"精确唯一字符串替换"。这是 OOC 修改已有文件
的**首选方式**——比 program(shell) + sed/awk 更安全（不需要担心转义）、更可见（修改在
file_window 上下次 render 自然出现）、并且支持原子多点修改。

它也是**大文件增量补全的搭档**：当 write_file 先写出骨架（结构 + 各 section 空壳/占位）后，
用 edit 把每个空壳逐段替换成真实内容——分段填充，每轮输出短，避免单轮超长生成超时。

## 调用形式

### 单次替换

\`\`\`
open(parent_window_id="<file_window_id>", method="edit",
     title="rename helper",
     args={ old: "function helperA(", new: "function helperB(" })
\`\`\`

### 一次提交多点替换（MultiEdit 风格，atomic-or-fail）

\`\`\`
open(parent_window_id="<file_window_id>", method="edit",
     title="batch rename",
     args={ edits: [
       { old: "function helperA(", new: "function helperB(" },
       { old: "/* old comment */",  new: "/* new comment */" }
     ]})
\`\`\`

数组形式按顺序应用：edit[i] 的 \`old\` 必须在 **应用完前 i-1 项之后** 的当前缓冲区里
**正好出现一次**。任意一项失败则整组不写盘。

## 规则

- \`old\` 必须在文件中**正好出现一次**（精确唯一）；如果出现 0 次或多次，整次 edit
  失败，文件不变，错误信息会标明：哪个文件、哪条 edit（数组下标）、原因（not found / matches N times）
- \`new\` 可以是空字符串（即"删除 old"）；也可以与 old 完全相同（no-op，但仍判定为成功）
- 修改立即写入磁盘；不存在"草稿/save"两阶段
- 想"扩大上下文以避免歧义"时，把 \`old\` 写得更长（含前后多行）即可

## edit 失败后的正确反应（**不要退化**）

收到 \`matches N times\` 错误 → 直接的应对是**把 \`old\` 写得更长**，包含前后几行
让它在全文中唯一，再 edit 一次。例：原 \`old: "count = 0"\` 全文 3 处 → 改成
\`old: "// 第一处计数初始化\\nconst count = 0"\` 只剩 1 处。

收到 \`not found\` 错误 → 用 file_window.reload 或重新读 file_window 当前可见内容
确认实际字符串（注意空白、引号、行尾），再 edit。

**不要**因为 edit 失败就改用 write_file 整文件覆盖——那等于放弃了精确性，重发整文件
你也可能漏字符、改错位；本来一个"扩大 old 上下文"就能解决。

## 与 shell / write_file 改文件的对比

- 不要再用 \`program(language="shell", code="sed -i ...")\` 改文件——容易踩转义陷阱、丢失
  file_window 的可见性、并且无法表达 atomic 多点修改
- 不要用 \`write_file\` 做"修改局部"——write_file 是整文件覆盖语义，详见 root.write_file 的 KNOWLEDGE
`.trim();

const reloadMethod: ObjectMethod = {
  paths: ["reload"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [FILE_WINDOW_RELOAD_BASIC]: RELOAD_KNOWLEDGE });
  },
  exec: () => undefined, // render 层每轮都会重读
};

const closeMethod: ObjectMethod = {
  paths: ["close"],
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [FILE_WINDOW_CLOSE_BASIC]: CLOSE_KNOWLEDGE });
  },
  exec: () => undefined,
};

const editMethod: ObjectMethod = {
  paths: ["edit"],
  schema: {
    args: {
      old: { type: "string", description: "要替换的旧字符串（必须在文件中正好出现一次）" },
      new: { type: "string", description: "替换后的新字符串" },
      edits: { type: "array", description: "批量替换 [{old, new}, ...]，与 old/new 二选一" },
    },
  },
  intent: emptyIntent,
  onFormChange: (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    // batch C narrowing(N1): onFormChange 的 form 契约层是 base，narrow 回 MethodExecWindow 取 accumulatedArgs。
    const args = change.kind === "args_refined" ? change.args : (form as MethodExecWindow).accumulatedArgs;
    const formStatus = form.status;
    const entries: Record<string, string> = { [FILE_WINDOW_EDIT_BASIC]: EDIT_KNOWLEDGE };
    if (formStatus !== "open") return buildGuidanceWindows(form, entries);
    const single = isString(args.old) && isString(args.new);
    const batch = Array.isArray(args.edits) && args.edits.length > 0;
    if (!single && !batch) {
      entries[FILE_WINDOW_EDIT_INPUT] =
        "file_window.edit 需要 args={ old, new } 或 args={ edits: [{old, new}, ...] }；二者择一。";
    }
    return buildGuidanceWindows(form, entries);
  },
  exec: (ctx) => executeFileWindowEdit(ctx),
};

interface EditPair {
  old: string;
  new: string;
}

/**
 * 解析 edit args 为 EditPair[]。
 * - { old, new } → [{old, new}]
 * - { edits: [{old, new}, ...] } → 原样
 * - 其它 → undefined
 */
function parseEdits(args: Record<string, unknown>): EditPair[] | undefined {
  if (isString(args.old) && isString(args.new)) {
    return [{ old: args.old, new: args.new }];
  }
  if (Array.isArray(args.edits)) {
    const out: EditPair[] = [];
    for (let i = 0; i < args.edits.length; i += 1) {
      const item = args.edits[i] as Record<string, unknown> | undefined;
      if (!item || !isString(item.old) || !isString(item.new)) return undefined;
      out.push({ old: item.old, new: item.new });
    }
    return out.length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * 把所有 edit 应用到 buffer。
 * 任何一条失败立即返回错误，不修改磁盘。
 *
 * 失败原因：
 * - "not found" — old 在当前 buffer 里完全不存在
 * - "matches N times" — old 在当前 buffer 里出现 N 次（>1）
 *
 * 注意：检查"正好出现一次"基于**当前 buffer**（已应用前面的 edit），而不是原始文件。
 * 这是 Claude Code MultiEdit 的语义。
 */
function applyEdits(
  initial: string,
  edits: EditPair[],
): { ok: true; result: string } | { ok: false; error: string } {
  let buffer = initial;
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i]!;
    // 计数 old 出现次数
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = buffer.indexOf(e.old, pos);
      if (idx === -1) break;
      count += 1;
      pos = idx + Math.max(e.old.length, 1);
      if (count > 1) break; // 早退；reportable
    }
    if (count === 0) {
      return { ok: false, error: `edit #${i}: oldString not found` };
    }
    if (count > 1) {
      // 走完整 count 用于错误信息
      let total = 0;
      let p2 = 0;
      while (true) {
        const idx = buffer.indexOf(e.old, p2);
        if (idx === -1) break;
        total += 1;
        p2 = idx + Math.max(e.old.length, 1);
      }
      return { ok: false, error: `edit #${i}: oldString matches ${total} times (must match exactly once)` };
    }
    // count === 1
    buffer = buffer.replace(e.old, e.new);
  }
  return { ok: true, result: buffer };
}

/**
 * file_window.edit：精确唯一替换。
 *
 * 行为：
 * - 必须挂在 file_window 上
 * - args 必须是 { old, new } 或 { edits: [{old, new}, ...] }
 * - 应用规则见 EDIT_KNOWLEDGE / applyEdits
 * - 成功：把新内容写回 window.path；返回 undefined
 * - 失败：不写盘；返回错误字符串（前缀 [file_window.edit]，便于 LLM 解析）
 */
/**
 * worktree 重定向决策（worktree 统一模型，单一落点）：当 file_window 指向**任何** stone
 * 自治区（自己 own 或别人 cross）的 main canonical 路径、且当前是普通业务 session 时，
 * identity 文件的读/写都应落到该 session 的 worktree
 * （`stones/session-<sid>/objects/<target>/...`，main HEAD 完整副本，含所有 objects/）。
 * 路径以**目标对象 id**（stoneClass.ownerObjectId）维度计算，而非 caller 自己的 objectId。
 *
 * @returns
 *  - undefined：不重定向 → 直读直写 window.path。命中以下任一即不重定向：
 *    非 stone 自治区路径 / 非业务 session / 已指向 worktree（worktree 路径 classify 为 non-package）/
 *    worktree 不可建（read 模式回退 main canonical；write 模式 caller 须 fail-loud，不裸写 main）。
 *  - string：worktree 内的目标绝对路径（读写同一路径——worktree 是完整副本，文件必在）。
 */
async function resolveStoneWorktreeTarget(
  ctx: MethodExecutionContext,
  absPath: string,
  mode: "read" | "write",
): Promise<string | undefined> {
  const thread = ctx.thread;
  const baseDir = thread?.persistence?.baseDir;
  const sessionId = thread?.persistence?.sessionId;
  if (!baseDir || !sessionUsesWorktree(sessionId)) return undefined;
  const stoneClass = classifyPackagesPath(absPath, baseDir);
  if (stoneClass.kind !== "package-object") return undefined;
  const targetObjectId = stoneClass.ownerObjectId;
  const rel = relWithinObjectFromPackages(targetObjectId, stoneClass.relInPackages);
  if (!rel) return undefined;
  // mode=read（open_file）：worktree 已建才重定向，不为一次读主动建 worktree（惰性）。
  // mode=write（edit）：lazy 建 worktree，写必落 worktree（保 versioning 边界，不裸写 main）。
  const wtRef = await resolveStoneIdentityRef(
    { baseDir, sessionId, objectId: targetObjectId },
    mode,
  );
  if (!wtRef._stonesBranch) return undefined; // 未建/建失败回退 main → 不重定向
  return join(stoneDir(wtRef), ...rel.split("/").filter(Boolean));
}

export async function executeFileWindowEdit(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  // P6.§3: manager 在 dispatch 阶段已保证 self.type === "file"，method 体不再 re-check。
  const window = ctx.self as FileWindow;
  const edits = parseEdits(ctx.args);
  if (!edits) {
    return "[file_window.edit] 缺少 args={ old, new } 或 args={ edits: [{old, new}, ...] }。";
  }

  // worktree 重定向：若 window 指向 caller 自己 stone 的 main canonical identity 文件且在
  // 业务 session，读写都落该 session 的 worktree（完整副本，含本 session 已改值），main 不动。
  // worktree 是 main HEAD 的完整 checkout，文件必在——读写同一路径，无 shadow/fallback。
  const wtTarget = await resolveStoneWorktreeTarget(ctx, window.path, "write");
  let readPath = window.path;
  let writePath = window.path;
  let toWorktree = false;
  if (wtTarget) {
    readPath = wtTarget;
    writePath = wtTarget;
    toWorktree = true;
  } else {
    // 未重定向但 window 指向 stone 自治区 + 业务 session = worktree 建失败 → fail-loud，
    // 绝不裸写 main 绕过版本化（resolveStoneWorktreeTarget undefined 的唯一危险分支）。
    const baseDir = ctx.thread?.persistence?.baseDir;
    const sessionId = ctx.thread?.persistence?.sessionId;
    if (baseDir && sessionUsesWorktree(sessionId)) {
      const stoneClass = classifyPackagesPath(window.path, baseDir);
      if (stoneClass.kind === "package-object") {
        return (
          `[file_window.edit] 无法为 session ${sessionId} 建立 worktree 落点（${window.path}）；` +
          `绝不裸写 main 绕过版本化。`
        );
      }
    }
  }

  let buffer: string;
  try {
    buffer = await readFile(readPath, "utf8");
  } catch (err) {
    return `[file_window.edit] 读取 ${readPath} 失败：${(err as Error).message}`;
  }

  const result = applyEdits(buffer, edits);
  if (result.ok === false) {
    return `[file_window.edit] ${readPath}: ${result.error}`;
  }

  try {
    if (toWorktree) await mkdir(dirname(writePath), { recursive: true });
    await writeFile(writePath, result.result, "utf8");
  } catch (err) {
    return `[file_window.edit] 写回 ${writePath} 失败：${(err as Error).message}`;
  }

  if (toWorktree && ctx.thread?.events) {
    ctx.thread.events.push({
      category: "context_change",
      kind: "inject",
      text:
        `[file_window.edit] 改动落在本 session 的 worktree（${writePath}），main 未变。` +
        `经 super flow evolve_self 合入 main 才永久生效。`,
    });
  }

  return undefined;
}

// file_window 的 compressView hook（readable 维度）已迁出到 ../readable.ts。

// ─────────────────────────── constructor (P6.§4) ────────────────────────────

/**
 * P6.§4 (2026-06-02): Constructor for the `file` Object type.
 *
 * Encapsulates the construction of a `file_window` ContextWindow. The root
 * methods `open_file` and `write_file` (in `@ooc/builtins/root`) become thin
 * delegators that call this constructor via `lookupConstructor("file")`.
 *
 * Two `paths` are exposed because two root methods construct file windows:
 *  - `open_file` — read-only window pointing at an existing file (path / lines / columns)
 *  - `write_file` — write content to disk (with optional stone versioning) then spawn a window
 *
 * Dispatch on `ctx.form?.method`:
 *  - method === "write_file": validate path + content, perform write (versioned for stones,
 *    direct for non-stone), then construct a FileWindow.
 *  - method === "open_file" (or anything else): validate path exists, then construct.
 *
 * Validation rules (per root method):
 *  - open_file: `path` is a non-empty string; resolved against session baseDir; must exist.
 *  - write_file: `path` is a non-empty string; `content` is a string (may be empty);
 *    if path falls inside a stone-object subtree (own or cross), write lands in the
 *    session worktree (super flow evolve_self merges to main);
 *    workspace-level packages/ paths are forbidden.
 *
 * Returns: `{ ok: true, object: FileWindow }` on success — manager.submit's §2 branch
 * inserts the window. Failure → `{ ok: false, error }` (form stays in failed state).
 */
const fileConstructor: ObjectMethod = {
  kind: "constructor",
  paths: ["open_file", "write_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（相对 session baseDir）" },
      content: { type: "string", description: "要写入的文件内容；提供时走 write_file 分支" },
      lines: { type: "array", description: "可选 [start, end]，open_file 时指定可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，open_file 时指定可见列范围" },
    },
  },
  intent: (args) => {
    if (typeof args.content === "string") return [{ name: "write_file" }];
    return [{ name: "open_file" }];
  },
  permission: () => "allow",
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[file] 缺少 thread context。" };
    // batch C narrowing(N1): ctx.form 契约层是 base ContextWindow，narrow 回 MethodExecWindow 读 command。
    const command = (ctx.form as MethodExecWindow | undefined)?.method ?? "open_file";

    if (command === "write_file") {
      const rawPath = isString(ctx.args.path) ? ctx.args.path : "";
      if (!rawPath) return { ok: false, error: "[write_file] 缺少 path 参数。" };
      const content = ctx.args.content;
      if (typeof content !== "string") {
        return { ok: false, error: "[write_file] 缺少 content 参数（应是字符串，可为空）。" };
      }
      const path = resolveSessionPath(thread, rawPath);
      const baseDir = thread.persistence?.baseDir;
      const stoneClass = classifyPackagesPath(path, baseDir);

      // 历史 write_file 的 preExisted hint：覆盖已有文件时给一条提示，把"修改局部用 edit"
      // 的规则推到 LLM 眼前。constructor outcome 不能返回 result 字符串（已被 manager 改成
      // "Constructed file window <id>"），所以改写为 thread 事件 inject。
      let preExisted = false;
      if (stoneClass.kind !== "package-object" && stoneClass.kind !== "packages-world") {
        try {
          const s = await stat(path);
          preExisted = s.isFile();
        } catch {
          /* 不存在 → 新建 */
        }
      }

      if (stoneClass.kind === "package-object") {
        const authorObjectId = thread.persistence?.objectId;
        if (!baseDir || !authorObjectId) {
          return {
            ok: false,
            error:
              `[write_file] 路径落在 packages 自治区 (${path}) 需走 versioning，但当前 thread ` +
              `缺少 ${!baseDir ? "persistence.baseDir" : "persistence.objectId"}，无法版本化写入。`,
          };
        }

        // worktree 写重定向（worktree 统一模型，单一落点）：业务 session 内对**任何** stone
        // 自治区的写（改自己 own + 改别人/建别人 cross）都落该 session 的 worktree
        // （`stones/session-<sid>/objects/<target>/...`，plain write，不 commit main）。
        // 路径以**目标对象 id**（stoneClass.ownerObjectId，可能 ≠ authorObjectId）维度计算：
        // worktree 是 main 完整副本含所有 objects/，stoneDir(wtRef) 拼到 objects/<target>/；
        // relWithinObject 也用 target 前缀剥。本 session 内即时生效（读写同一目录），main 不变，
        // 经 super flow evolve_self 合入才永久（self-scope ff-merge / cross-scope PR-Issue）。
        const sessionId = thread.persistence?.sessionId;
        const targetObjectId = stoneClass.ownerObjectId;
        const relWithinObject = relWithinObjectFromPackages(
          targetObjectId,
          stoneClass.relInPackages,
        );
        if (!sessionUsesWorktree(sessionId)) {
          return {
            ok: false,
            error:
              `[write_file] 路径落在 stone 自治区 (${path})，需在业务 session 的 worktree 内写入，` +
              `但当前不是业务 session（sessionId=${sessionId ?? "<none>"}）。控制面写请走 HTTP versioning endpoint。`,
          };
        }
        if (!relWithinObject) {
          return {
            ok: false,
            error:
              `[write_file] 无法把 ${path} 解析到对象 ${targetObjectId} 的 stone 根（relInPackages=${stoneClass.relInPackages}）。`,
          };
        }
        const wtRef = await resolveStoneIdentityRef(
          { baseDir, sessionId, objectId: targetObjectId },
          "write",
        );
        if (!wtRef._stonesBranch) {
          return {
            ok: false,
            error:
              `[write_file] 无法为 session ${sessionId} 建立 worktree 落点（写入 ${path} 失败）。` +
              `绝不裸写 main 绕过版本化。`,
          };
        }
        const wtTarget = join(stoneDir(wtRef), ...relWithinObject.split("/").filter(Boolean));
        try {
          await mkdir(dirname(wtTarget), { recursive: true });
          await writeFile(wtTarget, content, "utf8");
        } catch (err) {
          return { ok: false, error: `[write_file] 写入 worktree ${wtTarget} 失败：${(err as Error).message}` };
        }
        const isOwnStone = targetObjectId === authorObjectId;
        if (thread.events) {
          thread.events.push({
            category: "context_change",
            kind: "inject",
            text: isOwnStone
              ? `[write_file] ${path} 的改动落在本 session 的 worktree（${wtTarget}），` +
                `main 未变。本 session 内即时生效；要把它沉淀为正式身份，去 super flow 调 ` +
                `evolve_self 合入 main 才永久生效。`
              : `[write_file] 你改/建了别人的对象 ${targetObjectId}（${path}），改动落在本 session 的 ` +
                `worktree（${wtTarget}），main 未变。本 session 内即时生效；经 super flow evolve_self 时，` +
                `因越出你的自治区将开 PR-Issue 等 Supervisor 评审后才合入 main。`,
          });
        }
        const wtWindow: FileWindow = {
          id: generateWindowId("file"),
          type: "file",
          parentWindowId: ROOT_WINDOW_ID,
          title: basenameOfPath(path),
          status: "open",
          createdAt: Date.now(),
          path: wtTarget,
        };
        return { ok: true, object: wtWindow };
      } else if (stoneClass.kind === "packages-world") {
        return {
          ok: false,
          error:
            `[write_file] 路径 ${path} 落在 stones/main/ 根但不在某个 Object 的 ` +
            `子目录内（workspace-level 资源）。这类资源不能通过 write_file 修改。`,
        };
      } else {
        try {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, content, "utf8");
        } catch (err) {
          return { ok: false, error: `[write_file] 写入 ${path} 失败：${(err as Error).message}` };
        }
      }
      const fileWindow: FileWindow = {
        id: generateWindowId("file"),
        type: "file",
        parentWindowId: ROOT_WINDOW_ID,
        title: basenameOfPath(path),
        status: "open",
        createdAt: Date.now(),
        path,
      };
      if (preExisted) {
        if (thread.events) {
          thread.events.push({
            category: "context_change",
            kind: "inject",
            text:
              `[write_file hint] 你刚整文件覆盖了已有文件 ${path}。如果你的意图是"修改局部"` +
              `（而不是完整重写），下次请改走 file_window.edit：先 open_file 把文件载入 file_window，` +
              `再 open(parent_window_id=<file_window_id>, method="edit", args={ old, new })。` +
              `write_file 适合新建文件或确实要丢弃整个旧版本的场景。`,
          });
        }
      }
      return { ok: true, object: fileWindow };
    }

    // open_file path
    const rawPath = isString(ctx.args.path) ? ctx.args.path : "";
    if (!rawPath) return { ok: false, error: "[open_file] 缺少 path。" };
    let path = resolveSessionPath(thread, rawPath);
    // worktree 重定向（worktree 统一模型）：在业务 session 打开自己 stone 的 identity 文件时，
    // 若该 session 已建 worktree（改过 identity），window 指向 worktree 文件（读到本 session 最新
    // 内容）；未建则保持 main canonical（read 模式不为一次读主动建 worktree）。
    const openWtTarget = await resolveStoneWorktreeTarget(ctx, path, "read");
    if (openWtTarget) path = openWtTarget;
    try {
      await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { ok: false, error: `[open_file] 文件不存在: ${path}` };
      }
      return { ok: false, error: `[open_file] 校验 path 失败: ${(err as Error).message}` };
    }
    const fileWindow: FileWindow = {
      id: generateWindowId("file"),
      type: "file",
      parentWindowId: ROOT_WINDOW_ID,
      title: basenameOfPath(path),
      status: "open",
      createdAt: Date.now(),
      path,
      state: {
        viewport: { ...DEFAULT_VIEWPORT },
        lines: asTuple(ctx.args.lines),
        columns: asTuple(ctx.args.columns),
      },
    };
    return { ok: true, object: fileWindow };
  },
};

builtinRegistry.registerExecutable("file", {
  methods: {
    reload: reloadMethod,
    edit: editMethod,
    close: closeMethod,
    file: fileConstructor,
  },
});
// readable 维度（registerReadable：readable + window methods set_range/set_viewport + compressView）
// 在 ../readable.ts 自注册（asTuple 的 import 触发其加载）。
