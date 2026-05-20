/**
 * open tool — 在某 window 上 open 一个 command，创建一个 command_exec sub-window。
 *
 * 形态：
 *   open(parent_window_id?, command, args?, title, description?)
 *
 * - parent_window_id 缺省 = "root"；root 上注册了今天 commands/ 目录的全部 command
 * - command 必须是 parent window 注册的某个 command 名
 * - args 非空时等价于 open + 立即 refine(args)
 * - 有时当 args 完整时，open 会立刻提交 form 而无需再额外 submit；这由各个具体 command 的实现自行控制
 */

import type { LlmTool } from "../../thinkable/llm/types.js";
import type { ThreadContext } from "../../thinkable/context.js";
import { getOpenableCommands, ROOT_WINDOW_ID, WindowManager } from "../windows/index.js";
import { enrichProgramFormCommand } from "../server/enrich.js";
import { MARK_PARAM, TITLE_PARAM } from "./schema.js";

export const OPEN_TOOL: LlmTool = {
  name: "open",
  description:
    "在某 window 下打开一个 command（创建 command_exec form）。parent_window_id 缺省为 root",
  inputSchema: {
    type: "object",
    properties: {
      title: TITLE_PARAM,
      parent_window_id: {
        type: "string",
        description: "目标 window 的 id；缺省 = root（当前 thread 的根 window）。",
      },
      command: {
        type: "string",
        enum: getOpenableCommands(),
        description: "要在 parent window 上打开的 command 名。",
      },
      description: {
        type: "string",
        description: "本次 open 的意图说明；缺省时回退到 title。",
      },
      args: {
        type: "object",
        description: "command 的业务参数；如果不知道填什么可以留空，open 后系统会激活相关知识说明参数",
      },
      mark: MARK_PARAM,
    },
    required: ["title", "command"],
  },
};

function getArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nested = args.args;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return {};
}

const successOutput = (message: string, extra?: Record<string, unknown>) =>
  JSON.stringify({ ok: true, tool: "open", message, ...(extra ?? {}) });
const errorOutput = (error: string) => JSON.stringify({ ok: false, tool: "open", error });

export async function handleOpenTool(
  thread: ThreadContext,
  args: Record<string, unknown>,
): Promise<string | void> {
  const command = args.command as string | undefined;
  if (!command) {
    return errorOutput("open 缺少 command 参数。");
  }
  const title = (args.title as string | undefined)?.trim();
  if (!title) {
    return errorOutput("open 缺少 title 参数（所有 window 强制必填）。");
  }
  const description = (args.description as string | undefined) ?? title;
  const parentWindowId = (args.parent_window_id as string | undefined) ?? ROOT_WINDOW_ID;
  const nestedArgs = getArgs(args);

  const mgr = WindowManager.fromThread(thread);
  // 记录 open 前的 window id 集合, 用来识别本次 open (含 auto-submit) 派生的新 sub-window
  const beforeIds = new Set((thread.contextWindows ?? []).map((w) => w?.id).filter(Boolean) as string[]);
  let opened: { formId: string; autoSubmitted: boolean; submitResult?: string };
  try {
    opened = await mgr.openCommandExec({
      thread,
      parentWindowId,
      command,
      title,
      description,
      args: nestedArgs,
    });
  } catch (err) {
    return errorOutput(`open 失败：${(err as Error).message}`);
  }

  // program command + function 模式额外补 method 签名 knowledge（沿用旧 enrichProgramForm 行为）
  const targetForm = mgr.get(opened.formId);
  if (targetForm && targetForm.type === "command_exec" && targetForm.command === "program") {
    await enrichProgramFormCommand(targetForm, thread);
  }

  thread.contextWindows = mgr.toData();

  if (opened.autoSubmitted) {
    // 找到本次 auto-submit 派生的新 sub-window (e.g. grep → search_window, open_file → file_window).
    // 让 ChatPanel 的 link 按钮可以跳转到这个真正仍在 context 中的 window,
    // 而不是已 auto-removed 的 form_id (用户反馈 2026-05-20).
    const createdWindowId = (thread.contextWindows ?? [])
      .map((w) => w?.id)
      .filter((id): id is string => Boolean(id) && id !== opened.formId && !beforeIds.has(id))[0];
    return successOutput(
      `Form ${opened.formId} 已基于完整参数自动 submit；执行结果见下一轮 context。`,
      {
        form_id: opened.formId,
        auto_submitted: true,
        result: opened.submitResult,
        ...(createdWindowId ? { window_id: createdWindowId } : {}),
      },
    );
  }
  return successOutput(
    `Form ${opened.formId} 已创建（${command}）。后续用 refine(form_id, args)、submit(form_id) 或 close(form_id) 引用。`,
    { form_id: opened.formId, auto_submitted: false },
  );
}
