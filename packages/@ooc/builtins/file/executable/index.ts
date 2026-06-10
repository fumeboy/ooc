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
import { isString, basenameOfPath, asTuple } from "@ooc/builtins/_shared/executable/utils.js";


const MAX_FILE_WINDOW_BYTES = 32768;

const EDIT_TIP = `file_window.edit 在 file_window 上做"精确唯一字符串替换"（首选改文件方式）。

## 调用形式
- 单次替换：args={ old: "...", new: "..." }
- 一次多点：args={ edits: [{old, new}, ...] }（atomic-or-fail）

## 规则
- old 必须在文件中正好出现一次；否则失败（not found / matches N times）
- new 可为空串（删除 old）
- 修改立即写盘
- 失败时把 old 写得更长（含前后几行）让它唯一，再 edit 一次；不要退化成 write_file 整文件覆盖
- 不要再用 program(shell)+sed 改文件`;

const reloadMethod: ObjectMethod = {
  description: "Reload file content from disk (render re-reads each turn; this is a semantic hint).",
  exec: () => undefined,
};

const closeMethod: ObjectMethod = {
  description: "Close this file window (does not delete the file on disk).",
  exec: () => undefined,
};

const editMethod: ObjectMethod = {
  description: "Precise unique-string replacement on the file; supports atomic multi-edit.",
  schema: {
    args: {
      old: { type: "string", description: "要替换的旧字符串（必须在文件中正好出现一次）" },
      new: { type: "string", description: "替换后的新字符串" },
      edits: { type: "array", description: "批量替换 [{old, new}, ...]，与 old/new 二选一" },
    },
  },
  onFormChange(change, { args }) {
    const single = isString(args.old) && isString(args.new);
    const batch = Array.isArray(args.edits) && args.edits.length > 0;
    let tip = EDIT_TIP;
    let quick_exec_submit = false;
    if (!single && !batch) {
      tip = EDIT_TIP + "\n\n需要 args={ old, new } 或 args={ edits: [{old, new}, ...] }；二者择一。";
    } else {
      quick_exec_submit = true;
    }
    return { tip, intents: [{ name: "edit" }], quick_exec_submit };
  },
  exec: (ctx) => executeFileWindowEdit(ctx),
};

interface EditPair {
  old: string;
  new: string;
}

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

function applyEdits(
  initial: string,
  edits: EditPair[],
): { ok: true; result: string } | { ok: false; error: string } {
  let buffer = initial;
  for (let i = 0; i < edits.length; i += 1) {
    const e = edits[i]!;
    let count = 0;
    let pos = 0;
    while (true) {
      const idx = buffer.indexOf(e.old, pos);
      if (idx === -1) break;
      count += 1;
      pos = idx + Math.max(e.old.length, 1);
      if (count > 1) break;
    }
    if (count === 0) {
      return { ok: false, error: `edit #${i}: oldString not found` };
    }
    if (count > 1) {
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
    buffer = buffer.replace(e.old, e.new);
  }
  return { ok: true, result: buffer };
}

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
  const wtRef = await resolveStoneIdentityRef(
    { baseDir, sessionId, objectId: targetObjectId },
    mode,
  );
  if (!wtRef._stonesBranch) return undefined;
  return join(stoneDir(wtRef), ...rel.split("/").filter(Boolean));
}

export async function executeFileWindowEdit(
  ctx: MethodExecutionContext,
): Promise<string | undefined> {
  const window = ctx.self as FileWindow;
  const edits = parseEdits(ctx.args);
  if (!edits) {
    return "[file_window.edit] 缺少 args={ old, new } 或 args={ edits: [{old, new}, ...] }。";
  }

  const wtTarget = await resolveStoneWorktreeTarget(ctx, window.path, "write");
  let readPath = window.path;
  let writePath = window.path;
  let toWorktree = false;
  if (wtTarget) {
    readPath = wtTarget;
    writePath = wtTarget;
    toWorktree = true;
  } else {
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

// ─────────────────────────── constructor (P6.§4) ────────────────────────────

const FILE_CONSTRUCTOR_TIP_OPEN = `open_file: 提供 path（相对 session baseDir），可选 lines/columns 指定视口。`;
const FILE_CONSTRUCTOR_TIP_WRITE = `write_file: 提供 path（相对 session baseDir）和 content（字符串，可为空）。`;

const fileConstructor: ObjectMethod = {
  kind: "constructor",
  description: "Open an existing file (read-only window) or write new content to a file.",
  intents: ["open_file", "write_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（相对 session baseDir）" },
      content: { type: "string", description: "要写入的文件内容；提供时走 write_file 分支" },
      lines: { type: "array", description: "可选 [start, end]，open_file 时指定可见行范围" },
      columns: { type: "array", description: "可选 [start, end]，open_file 时指定可见列范围" },
    },
  },
  permission: () => "allow",
  onFormChange(change, { args }) {
    const isWrite = typeof args.content === "string";
    const intents = [{ name: isWrite ? "write_file" : "open_file" }];
    let tip = isWrite ? FILE_CONSTRUCTOR_TIP_WRITE : FILE_CONSTRUCTOR_TIP_OPEN;
    let quick_exec_submit = false;
    if (isString(args.path)) {
      tip = isWrite ? `Writing file ${args.path}...` : `Opening file ${args.path}...`;
      quick_exec_submit = true;
    }
    return { tip, intents, quick_exec_submit };
  },
  exec: async (ctx) => {
    const thread = ctx.thread;
    if (!thread) return { ok: false, error: "[file] 缺少 thread context。" };
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
          class: "file",
          parentWindowId: ROOT_WINDOW_ID,
          title: basenameOfPath(path),
          status: "open",
          createdAt: Date.now(),
          path: wtTarget,
        };
        return { ok: true, window: wtWindow };
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
        class: "file",
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
      return { ok: true, window: fileWindow };
    }

    // open_file path
    const rawPath = isString(ctx.args.path) ? ctx.args.path : "";
    if (!rawPath) return { ok: false, error: "[open_file] 缺少 path。" };
    let path = resolveSessionPath(thread, rawPath);
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
      class: "file",
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
    return { ok: true, window: fileWindow };
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
