/**
 * root.write_file command — 创建或覆盖一个文件，并自动 spawn 一个 file_window 指向它。
 *
 * - args: path（必填）, content（必填）
 * - 父目录不存在时自动 mkdir -p
 * - 写盘成功后立即 spawn 一个 file_window，让接下来的 file_window.edit 与 LLM 后续的
 *   "open_file then edit" 体验完全一致
 * - 失败时返回错误字符串；不会留下半成品 file_window
 *
 * 与 program(language="shell", code="echo ... > ...") 的差别：write_file 表达的是
 * "把这段内容当作文件版本"，自带版本可见性（file_window 渲染）；shell 重定向是黑盒。
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  MethodExecOutcome,
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
} from "../_shared/method-types.js";
import {
  ROOT_WINDOW_ID,
  generateWindowId,
  type FileWindow,
} from "../_shared/types.js";
import { classifyStonesPath, resolveSessionPath } from "../_shared/session-path.js";
import { versionedStoneWrite } from "../../../persistable/index.js";

const WRITE_FILE_BASIC_PATH = "internal/executable/write_file/basic";
const WRITE_FILE_INPUT_PATH = "internal/executable/write_file/input";

const KNOWLEDGE = `
write_file = **整文件覆盖**。只在下列两种场景使用：

1. **新建一个还不存在的文件**（path 在磁盘上不存在）
2. **完整重写一个已存在文件**（你确实要丢弃旧内容、用新内容全部替代）

**修改已有文件的局部内容 → 必须用 file_window.edit，不要用 write_file**
- 原因 1（正确性）：write_file 要你重发整个文件，任何漏掉的字符或顺序错位都会
  造成静默丢失；edit 用"精确唯一字符串替换"保证只动你指定的位置
- 原因 2（成本）：edit 只送 old/new 两段；write_file 要送整文件，长文件可能上千行
- 原因 3（可见性）：失败的 edit 给出准确错误（哪条 edit、为什么、几次匹配），write_file
  失败你只会看到一个 path 错

典型反模式（**不要这样做**）：
- 用户说"把 src/foo.ts 里第一处 X 改成 Y" → 你 open_file 后直接 write_file 整篇
  → 应该 \`open_file\` → \`open(parent_window_id=<file_window>, command="edit",
  args={old: "X 的局部唯一上下文", new: "Y 的对应上下文"})\`

## 参数

- path: 必填，目标文件路径（绝对，或相对 session baseDir）。父目录不存在会自动 mkdir -p
- content: 必填，要写入的完整文件内容（字符串；空字符串表示写一个 0 字节文件）

## 副作用

- 写盘成功 → 在 thread.contextWindows 下挂一个 type=file 的 window 指向 path
- 失败（权限不足 / 路径不合法）→ 返回错误字符串，不留 file_window，不写盘

## 调用示例（合法场景：新建）

\`\`\`
open(command="write_file", title="新建测试文件",
     args={ path: "tests/foo.test.ts", content: "import { it } from 'bun:test'; ..." })
\`\`\`

## 大文件分段产出（避免单轮超时）

产出较大文件（完整 UI 页面 / 长文档 / 多 section 模块）时，**不要一次 write_file 灌入整页**——
单轮生成超长 content 会触发 LLM 输出超时，最坏 0 产物失败。改为两步：

1. write_file 先写**骨架**：结构框架 + 各 section 的标题/空壳/占位（短而完整）
2. 再对生成的 file_window 逐段 \`edit\`：把每个 section 的空壳替换成真实内容（见 file_window.edit）

骨架 + 分段填充让每一轮输出都短、可恢复、可见。

## 不要用 shell 替代

不要用 \`program(language="shell", code="echo ... > ...")\` 做这件事——会失去
file_window 的版本可见性，且转义容易出错。
`.trim();

function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 写盘成功后在 thread 下挂一个 file_window 指向 path（stone 与 non-stone 路径共用）。 */
function spawnFileWindow(ctx: MethodExecutionContext, path: string): void {
  const fileWindow: FileWindow = {
    id: generateWindowId("file"),
    type: "file",
    parentWindowId: ROOT_WINDOW_ID,
    title: basename(path),
    status: "open",
    createdAt: Date.now(),
    path,
  };
  if (ctx.manager) {
    ctx.manager.insertTypedWindow(fileWindow);
  } else if (ctx.thread) {
    ctx.thread.contextWindows = [...(ctx.thread.contextWindows ?? []), fileWindow];
  }
}

export const writeFileCommand: MethodEntry = {
  paths: ["write_file"],
  match: () => ["write_file"],
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [WRITE_FILE_BASIC_PATH]: KNOWLEDGE };
    if (formStatus !== "open") return entries;
    const path = typeof args.path === "string" ? args.path : "";
    const hasContent = typeof args.content === "string";
    if (!path || !hasContent) {
      const missing: string[] = [];
      if (!path) missing.push("path");
      if (!hasContent) missing.push("content");
      entries[WRITE_FILE_INPUT_PATH] =
        `write_file 还缺以下参数: ${missing.join(", ")}。\n` +
        "请用 refine(form_id, args={ path: \"<path>\", content: \"<完整文件内容, 可空串>\" }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeWriteFileCommand(ctx),
};

export async function executeWriteFileCommand(
  ctx: MethodExecutionContext,
): Promise<string | undefined | MethodExecOutcome> {
  const thread = ctx.thread;
  if (!thread) return "[write_file] 缺少 thread context。";
  const rawPath = typeof ctx.args.path === "string" ? ctx.args.path : "";
  if (!rawPath) return "[write_file] 缺少 path 参数。";
  const content = ctx.args.content;
  if (typeof content !== "string") return "[write_file] 缺少 content 参数（应是字符串，可为空）。";

  // 相对路径以 session baseDir 为根（不再以 OOC 进程 cwd 为根）
  const path = resolveSessionPath(thread, rawPath);

  // 写之前看一眼文件是否已存在——存在意味着 LLM 正在"整文件覆盖"已有文件。
  // 这是 write_file 的合法用例之一（"完整重写"），但更常见的误用是"想改局部却用了 write_file"，
  // 因此覆盖时附一条 hint，把 KNOWLEDGE 的"修改局部用 edit"的规则推到 LLM 眼前。
  let preExisted = false;
  try {
    const s = await stat(path);
    preExisted = s.isFile();
  } catch {
    /* 不存在 → 新建场景，无 hint */
  }

  // stones/ 路径归属判定（2026-05-28）：写 stone 自治区必须经 stone-versioning
  // （git commit + self-scope ff-merge / cross-scope PR-Issue），不能裸 writeFile 绕过版本控制。
  // pools/ flows/ work/ 等非 stones 路径保持现状直写（运行时数据不进 git）。
  const baseDir = thread.persistence?.baseDir;
  const stonesBranch = thread.persistence?.stonesBranch;
  const stoneClass = classifyStonesPath(path, baseDir, stonesBranch);

  if (stoneClass.kind === "stone-object") {
    const authorObjectId = thread.persistence?.objectId;
    if (!baseDir || !authorObjectId) {
      // fail-loud：无法确定 author / world 根时不能静默直写绕过 versioning。
      return (
        `[write_file] 路径落在 stones 自治区 (${path}) 需走 stone-versioning，但当前 thread ` +
        `缺少 ${!baseDir ? "persistence.baseDir" : "persistence.objectId"}，无法版本化写入。`
      );
    }
    const versioned = await versionedStoneWrite({
      baseDir,
      authorObjectId,
      intent: `write_file ${stoneClass.relInObjects}`,
      // 写入 worktree 工作树：${worktree.path}/objects/<ownerObjectId>/...（relInObjects 已含 objects/ 前缀）
      write: async (wt) => {
        const target = join(wt.path, stoneClass.relInObjects);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
      },
    });
    if (!versioned.ok) {
      return `[write_file] stone-versioning 写入失败 (${versioned.code})：${versioned.message}`;
    }
    // self-scope ff-merge 后 main 工作区已反映新内容；cross-scope 落 PR-Issue 等 Supervisor 决议。
    spawnFileWindow(ctx, path);
    const scopeNote = versioned.merged
      ? `已 commit 并合并回 main（commit ${versioned.commitSha.slice(0, 8)}）`
      : `改动越出你的自治区，已开 PR-Issue #${versioned.prIssueId} 等 Supervisor 评审（暂未合并到 main）`;
    return {
      ok: true,
      result: `[write_file] ${path} 经 stone-versioning ${scopeNote}。`,
    };
  }

  if (stoneClass.kind === "stones-world") {
    // world-level stone 资源（如 stones/main/.gitignore，不在 objects/ 下）——LLM 不该
    // 通过 write_file 改它（属于 world/治理边界）。fail-loud，不静默直写绕过 versioning。
    return (
      `[write_file] 路径 ${path} 落在 stones/${stonesBranch ?? "main"}/ 根但不在某个 Object 的 ` +
      `objects/<id>/ 自治区内（world-level stone 资源）。这类资源不能通过 write_file 修改；` +
      `如确需变更请走治理流程（HTTP 控制面 / Supervisor）。`
    );
  }

  // non-stone（pools/ flows/ work/ 任意其它路径）：保持现状直写。
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  } catch (err) {
    return `[write_file] 写入 ${path} 失败：${(err as Error).message}`;
  }

  spawnFileWindow(ctx, path);

  if (preExisted) {
    return {
      ok: true,
      result:
        `[write_file hint] 你刚整文件覆盖了已有文件 ${path}。如果你的意图是"修改局部"` +
        `（而不是完整重写），下次请改走 file_window.edit：先 open_file 把文件载入 file_window，` +
        `再 open(parent_window_id=<file_window_id>, command="edit", args={ old, new })。` +
        `write_file 适合新建文件或确实要丢弃整个旧版本的场景。`,
    };
  }
  return undefined;
}
