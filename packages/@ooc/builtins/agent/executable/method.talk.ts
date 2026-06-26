/**
 * agent.talk —— agent agency 核心 method：开启一条 thread 对话。
 *
 * 行为：经 `ctx.runtime.instantiate({class: "_builtin/agent/thread", args:{...}})` 造一条 thread
 * 实例。thread.construct 据 callerObjectId / calleeObjectId / msg 初始化：
 *   - target = 别的 objectId ⇒ peer 跨对象会话
 *   - target = 自己的 objectId ⇒ fork 同对象子线程
 *   - target = "super"（SUPER_ALIAS_TARGET，trim+lowercase 归一） ⇒ **跨 session 自指**：
 *     caller 在原 session、callee 在 super flow（sessionId="super"）、对端 = caller self。
 *     幂等键 = `(callerSessionId, callerObjectId)`：caller object data 持
 *     `superThreadRef?:{threadId, sessionId}`；存在则复用已有 super thread，否则建新并写回 ref。
 *
 * super alias 路径不走 `ctx.runtime.instantiate`（它绑定当前 ctx 的 sessionId）：
 *   - 直接生成 threadId；
 *   - 物理写入 super flow 内 `flows/super/objects/<calleeObjectId>/threads/<threadId>/thread.json`
 *     （含初始 message 和 `.flow.json` class 标记）；
 *   - 写回 caller `data.superThreadRef = { threadId, sessionId: "super" }` + reportDataEdit；
 *   - 已有 ref + 有 msg → 把消息直接 append 到 super thread 的 messages 数组（跨 session inbox
 *     派送，避免引入新 cross-session bus 基础设施；issue D 落地裁决 2）。
 *
 * 返回新 thread 的 ref。
 */
import type { ExecutableContext, ObjectMethod } from "@ooc/core/types/index.js";
import {
  THREAD_CLASS_ID,
  SUPER_ALIAS_TARGET,
  SUPER_SESSION_ID,
} from "@ooc/core/types/constants.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { objectDir, toJson } from "@ooc/core/persistable/common.js";
import { createFlowSession } from "@ooc/core/persistable/flow-object.js";
import { generateMessageId, generateThreadId } from "@ooc/builtins/agent/children/thread/executable/utils.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import type { Data } from "../types.js";

/** 把 target 归一为字面（trim + lowercase）便于识别 super alias。 */
function normalizeTarget(target: string): string {
  return target.trim().toLowerCase();
}

/** 把一条消息 append 到 super flow 内某 thread 的 thread.json messages 数组。 */
async function appendMessageToSuperThread(
  baseDir: string,
  calleeObjectId: string,
  threadId: string,
  content: string,
): Promise<void> {
  const dir = join(
    objectDir({ baseDir, sessionId: SUPER_SESSION_ID, objectId: calleeObjectId }),
    "threads",
    threadId,
  );
  const file = join(dir, "thread.json");
  const raw = await readFile(file, "utf8");
  const thread = JSON.parse(raw) as {
    messages: Array<{ id: string; content: string; createdAt: number; from: "caller" | "callee" }>;
  };
  thread.messages.push({
    id: generateMessageId(),
    content,
    createdAt: Date.now(),
    from: "caller",
  });
  await writeFile(file, toJson(thread), "utf8");
}

/**
 * 在 super flow 新建一条 thread（callee = caller）的 thread.json + .flow.json 元数据。
 *
 * 复用 createFlowSession 确保 `flows/super/` 与 `.session.json` 就绪；super session 不走 worktree
 * （sessionUsesWorktree 排除）。
 */
async function createSuperThread(
  ctx: ExecutableContext,
  calleeObjectId: string,
  initialMessage: string | undefined,
): Promise<string> {
  const baseDir = ctx.worldDir;
  await createFlowSession(baseDir, SUPER_SESSION_ID, "super flow");

  const threadId = generateThreadId();
  const dir = join(
    objectDir({ baseDir, sessionId: SUPER_SESSION_ID, objectId: calleeObjectId }),
    "threads",
    threadId,
  );
  await mkdir(dir, { recursive: true });

  const messages = initialMessage
    ? [
        {
          id: generateMessageId(),
          content: initialMessage,
          createdAt: Date.now(),
          from: "caller" as const,
        },
      ]
    : [];

  // 最小 ThreadContext shape（与 thread/persistable save 落盘形态一致）。
  // contextWindows 当前不预填——super flow scheduler 唤醒时按需 hydrate。
  const thread = {
    id: threadId,
    calleeObjectId,
    sessionId: SUPER_SESSION_ID,
    status: "running",
    messages,
    events: [],
    contextWindows: [
      { id: calleeObjectId, class: "self", createdAt: Date.now(), closable: false },
    ],
  };
  await writeFile(join(dir, "thread.json"), toJson(thread), "utf8");
  await writeFile(
    join(dir, ".flow.json"),
    toJson({ type: "flow-object", sessionId: SUPER_SESSION_ID, objectId: threadId, class: THREAD_CLASS_ID }),
    "utf8",
  );
  return threadId;
}

export const talkMethod: ObjectMethod<Data> = {
  name: "talk",
  description:
    "Start a new thread (conversation) with a target object. target=other objectId ⇒ peer; target=self ⇒ fork; target='super' ⇒ cross-session self-reference into super flow (idempotent reuse). Returns the thread ref.",
  schema: {
    target: {
      type: "string",
      required: true,
      description: "对端 objectId（自己 ⇒ fork 子线程；'super' ⇒ 跨 session 进 super flow 与自己对话）",
    },
    msg: { type: "string", required: false, description: "首条消息（可选）" },
    title: { type: "string", required: false, description: "会话标题（peer 推荐）" },
  },
  permission: () => "allow",
  exec: async (ctx: ExecutableContext, self, args: Record<string, unknown>) => {
    const rawTarget = typeof args.target === "string" ? args.target : "";
    if (!rawTarget) return { err: "[talk] missing target" };
    const msg = typeof args.msg === "string" ? args.msg : undefined;

    const normalizedTarget = normalizeTarget(rawTarget);
    if (normalizedTarget === SUPER_ALIAS_TARGET) {
      // 跨 session 自指（issue D 落地裁决 2）
      const callerObjectId = ctx.object.id;
      const existingRef = (self.data as Data).superThreadRef;

      if (existingRef && existingRef.sessionId === SUPER_SESSION_ID) {
        // 已有绑定 → 复用 super thread；有 msg 直接 append；无 msg 仅返回 ref。
        if (msg) {
          try {
            await appendMessageToSuperThread(
              ctx.worldDir,
              callerObjectId,
              existingRef.threadId,
              msg,
            );
          } catch (e) {
            return {
              err: `[talk:super] append message failed (existing ref may be stale): ${(e as Error).message}`,
            };
          }
        }
        const ref: OocObjectRef = {
          id: existingRef.threadId,
          class: THREAD_CLASS_ID,
          createdAt: Date.now(),
        };
        return {
          message: `[talk:super] reused thread ${existingRef.threadId} in super flow`,
          refs: [ref],
        };
      }

      // 无绑定 → 新建 super thread + 写回 ref
      const threadId = await createSuperThread(ctx, callerObjectId, msg);
      (self.data as Data).superThreadRef = { threadId, sessionId: SUPER_SESSION_ID };
      await ctx.reportDataEdit();
      const ref: OocObjectRef = {
        id: threadId,
        class: THREAD_CLASS_ID,
        createdAt: Date.now(),
      };
      return {
        message: `[talk:super] thread ${threadId} opened in super flow with self (${callerObjectId})`,
        refs: [ref],
      };
    }

    // 普通 target（peer / fork-self）
    const ref = await ctx.runtime.instantiate({
      class: THREAD_CLASS_ID,
      args: { calleeObjectId: rawTarget, message: msg },
    });
    return {
      message: `[talk] thread ${ref.id} opened with ${rawTarget}`,
      refs: [ref],
    };
  },
};
