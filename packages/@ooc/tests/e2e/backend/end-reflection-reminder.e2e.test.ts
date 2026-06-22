/**
 * end-reflection-reminder thread-level 集成测试。
 *
 * end-reflection 知识（builtins/agent/knowledge/end-reflection.md，activates_on
 * `method::_builtin/agent::end`）应在业务 thread 开 end method form 时经完整 buildInputItems
 * 路径渲染进 system content；非 end form 时不出现。
 *
 * Wave 4 对象模型：method form 是一条 `OocObjectRef` 实例——class="method_exec"、
 * 业务字段（method/intentPaths…）落 inst.data。activator 的 `method::` trigger 据
 * inst.data.method + 其 parentWindowId 指向的 self 窗 class（须解析到 `_builtin/agent`）命中。
 *
 * 不真起 backend / 不调 LLM；buildInputItems 是纯函数。
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeThread } from "@ooc/core/__tests__/make-thread";
import { buildInputItems } from "@ooc/builtins/agent/thread/thinkable/context/index";
import { buildProtocolKnowledgeWindows } from "@ooc/builtins/agent/thread/thinkable/context/protocol";
import { isKnowledgeClass } from "@ooc/core/_shared/types/constants.js";
import { objectDataOf } from "@ooc/core/_shared/types/context-window.js";
import type { OocObjectRef } from "@ooc/core/runtime/ooc-class.js";
import {
  getSessionObjectTable,
  materializeWindow,
} from "@ooc/core/runtime/session-object-table.js";
import type { ThreadContext } from "@ooc/core/_shared/types/thread.js";
import type { ThreadPersistenceRef } from "@ooc/core/persistable/common";

// 触发 builtin class 注册（含 _builtin/agent + method_exec_form）。
import "@ooc/core/runtime/register-builtins.js";

/** end-reflection.md body 的特征短语（仅出现在该篇正文中）。 */
const END_REFLECTION_MARKER = "endSummary 不进入下一轮";

/** 业务 thread 的 self 窗：class=_builtin/agent，使 method::_builtin/agent::end 能命中 parent。 */
const SELF_WINDOW_ID = "w_self_agent";
/** 窗=ref + object（class+data）入 session 对象表（materializeWindow 一处搞定）。 */
function addSelfAgentWindow(thread: ThreadContext): OocObjectRef {
  return materializeWindow(thread, {
    id: SELF_WINDOW_ID,
    class: "_builtin/agent",
    data: {},
    parentWindowId: "root",
    title: "alice (self)",
    status: "open",
    createdAt: 1,
  });
}

/** method form 窗：class=method_exec，method 落 object data（入对象表），parent 指向 self 窗。 */
function addMethodExecWindow(
  thread: ThreadContext,
  opts: { method: string; id: string },
): OocObjectRef {
  return materializeWindow(thread, {
    id: opts.id,
    class: "method_exec",
    data: {
      method: opts.method,
      description: "",
      accumulatedArgs: {},
      intentPaths: [opts.method],
      loadedKnowledgePaths: [],
      status: "open",
    },
    parentWindowId: SELF_WINDOW_ID,
    title: opts.method,
    status: "open",
    createdAt: 2,
  });
}

function setupRef(opts: { sessionId: string; tag: string }): {
  ref: ThreadPersistenceRef;
  cleanup: () => void;
} {
  const tmpRoot = mkdtempSync(join(tmpdir(), `ooc-end-reflection-${opts.tag}-`));
  const ts = Date.now();
  const ref: ThreadPersistenceRef = {
    baseDir: tmpRoot,
    sessionId: opts.sessionId,
    objectId: "alice",
    threadId: `t_test_thinkable_${ts}`,
  };
  return { ref, cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }) };
}

/** 收集 input items 的 system role content。 */
function systemContent(input: Awaited<ReturnType<typeof buildInputItems>>): string {
  return input.input
    .filter((it): it is Extract<typeof it, { type: "message" }> => it.type === "message")
    .filter((it) => it.role === "system")
    .map((it) => it.content)
    .join("\n\n");
}

/**
 * 从投影 knowledge 窗收集**正文已激活**（presentation="full" → show_content）的 path。
 *
 * class 是注册 id KNOWLEDGE_CLASS_ID，path / presentation 落 inst.data。只看 full：
 * end-reflection 的 `object::root` 触发器恒以 show_description 激活（body 空），唯有
 * `method::_builtin/agent::end` 命中时才升到 show_content（body 进 context）——这正是被门控的语义。
 */
function paths(thread: ThreadContext, windows: OocObjectRef[]): string[] {
  const table = getSessionObjectTable(thread);
  return windows
    .filter((w) => isKnowledgeClass(w.class))
    .filter((w) => (objectDataOf(w, table) as { presentation?: string } | undefined)?.presentation === "full")
    .map((w) => (objectDataOf(w, table) as { path?: string } | undefined)?.path ?? "");
}

describe("end-reflection-reminder thread-level integration", () => {
  it("业务 thread + end form → input system content 含 end-reflection", async () => {
    const { ref, cleanup } = setupRef({ sessionId: "_test_thinkable_business_end", tag: "business-end" });
    try {
      const thread = makeThread({ id: ref.threadId, persistence: ref });
      thread.contextWindows = [
        ...thread.contextWindows,
        addSelfAgentWindow(thread),
        addMethodExecWindow(thread, { method: "end", id: "f_end_biz" }),
      ];

      // 防御性 gate：协议层已激活 end-reflection 篇
      expect(paths(thread, await buildProtocolKnowledgeWindows(thread))).toContain("end-reflection");

      // 完整路径：buildInputItems → system message 含 end-reflection body 关键字段
      const sys = systemContent(await buildInputItems(thread));
      expect(sys).toContain(END_REFLECTION_MARKER);
      expect(sys).toContain('target: "super"');
    } finally {
      cleanup();
    }
  });

  it("业务 thread + 非 end form (talk) → input system content 不含 end-reflection（门控）", async () => {
    const { ref, cleanup } = setupRef({ sessionId: "_test_thinkable_business_talk", tag: "business-talk" });
    try {
      const thread = makeThread({ id: ref.threadId, persistence: ref });
      thread.contextWindows = [
        ...thread.contextWindows,
        addSelfAgentWindow(thread),
        addMethodExecWindow(thread, { method: "talk", id: "f_talk_biz" }),
      ];

      expect(paths(thread, await buildProtocolKnowledgeWindows(thread))).not.toContain("end-reflection");
      const sys = systemContent(await buildInputItems(thread));
      expect(sys).not.toContain(END_REFLECTION_MARKER);
    } finally {
      cleanup();
    }
  });
});
