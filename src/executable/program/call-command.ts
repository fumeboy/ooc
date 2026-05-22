import type { ThreadContext } from "../../thinkable/context.js";
import { formatProgramResult } from "./format.js";
import { getWindowTypeDefinition } from "../windows/_shared/registry.js";
import { createProgramSelf } from "../server/self.js";
import { loadObjectWindow } from "../server/loader.js";
import { deriveStoneFromThread } from "../../persistable/index.js";
import type { CommandExecutionContext, CommandTableEntry } from "../windows/_shared/command-types.js";
import type { ProgramSelf } from "../server/types.js";

/**
 * program.callCommand 主入口（plan §6.3 / D4）。
 *
 * 在 program form / ts-js sandbox 的"调命令"模式下被调用：根据 windowId 在
 * thread.contextWindows 中找到目标 window，按 WindowRegistry 取该 window type 的
 * commands[command] entry，构造 ctx 后 exec 之。
 *
 * 与旧 program.fn 模式的差异：
 * - 不再绑定 self window；可调任意 thread 内 window 的任意已注册 command
 * - 必填参数 `function` 改为 `window_id` + `command`
 */
export async function runCallCommandProgram(
  thread: ThreadContext,
  windowId: string,
  command: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tag = `# callCommand: ${windowId}.${command}`;

  const window = thread.contextWindows.find((w) => w.id === windowId);
  if (!window) {
    const visible = thread.contextWindows.map((w) => `${w.id}(${w.type})`).join(", ") || "(无)";
    return formatProgramResult(
      tag,
      "",
      undefined,
      `windowId ${windowId} 不在当前 thread.contextWindows；当前可见：${visible}`,
    );
  }

  let entry: CommandTableEntry | undefined;
  // type=custom 时直接走 ObjectWindowDefinition.commands；其它 type 走 WindowRegistry
  if (window.type === "custom") {
    const objectId = (window as { objectId?: string }).objectId;
    if (!objectId) {
      return formatProgramResult(tag, "", undefined, `custom window ${windowId} 缺少 objectId`);
    }
    if (!thread.persistence) {
      return formatProgramResult(tag, "", undefined, `thread 无 persistence；无法定位 stone server`);
    }
    try {
      const def = await loadObjectWindow({ ...thread.persistence, objectId });
      entry = def?.commands?.[command];
      if (!entry) {
        const avail = Object.keys(def?.commands ?? {}).join(", ") || "(无)";
        return formatProgramResult(
          tag,
          "",
          undefined,
          `command ${command} 不存在于 custom window；当前可用：${avail}`,
        );
      }
    } catch (err) {
      return formatProgramResult(tag, "", undefined, (err as Error).message);
    }
  } else {
    try {
      entry = getWindowTypeDefinition(window.type).commands[command];
    } catch (err) {
      return formatProgramResult(tag, "", undefined, (err as Error).message);
    }
    if (!entry) {
      return formatProgramResult(
        tag,
        "",
        undefined,
        `command ${command} 不存在于 type=${window.type} 上`,
      );
    }
  }

  // 构造 ctx + 注入 self（custom 与内置 type 都需要）
  const ctx: CommandExecutionContext & { self?: ProgramSelf } = {
    thread,
    parentWindow: window,
    args,
  };
  if (thread.persistence) {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    ctx.self = createProgramSelf(stoneRef, thread);
  }

  try {
    const out = await entry.exec(ctx);
    if (out === undefined) {
      return formatProgramResult(tag, "", undefined);
    }
    if (typeof out === "string") {
      return formatProgramResult(tag, "", out);
    }
    if (typeof out === "object" && out && "ok" in out) {
      const outcome = out as { ok: boolean; result?: string; error?: string };
      if (outcome.ok) return formatProgramResult(tag, "", outcome.result);
      return formatProgramResult(tag, "", undefined, outcome.error ?? "(未知错误)");
    }
    return formatProgramResult(tag, "", String(out));
  } catch (error) {
    return formatProgramResult(tag, "", undefined, (error as Error).message);
  }
}
