/**
 * tools-open primitive test —— issue E：open 第 4 原语 dispatch → method_exec_form 挂载 + want
 * 落进 form data + readable render 含 want 子节点。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { ThreadRuntime } from "@ooc/builtins/agent/children/thread";
import { dispatchToolCall } from "@ooc/builtins/agent/children/thread/thinkable/tools/dispatch";
import { PRIMITIVE_TOOLS, OPEN_TOOL } from "@ooc/builtins/agent/children/thread/thinkable/tools/schema";
import { renderReadable } from "@ooc/core/readable";
import { xmlText, serializeXml, xmlElement } from "@ooc/core/types/xml";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { Data as FormData } from "@ooc/builtins/agent/children/method_exec_form/types";

const SESSION = "test-tools-open";

async function makeThread(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId: SESSION, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hello" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

describe("tools/open primitive (issue E)", () => {
  beforeEach(() => releaseSessionRegistry(SESSION));
  afterEach(() => releaseSessionRegistry(SESSION));

  it("PRIMITIVE_TOOLS exposes 4 tools including 'open'", () => {
    expect(PRIMITIVE_TOOLS).toHaveLength(4);
    expect(PRIMITIVE_TOOLS.map((t) => t.name).sort()).toEqual(["close", "exec", "open", "wait"]);
    expect(OPEN_TOOL.name).toBe("open");
    const props = (OPEN_TOOL.inputSchema as any).properties;
    expect(props.objectId).toBeDefined();
    expect(props.methodName).toBeDefined();
    expect(props.want).toBeDefined();
  });

  it("runtime.open mounts a method_exec_form with want injected, readable renders <want>", async () => {
    const t = await makeThread();
    const reg = getSessionRegistry(SESSION);
    // First instantiate a todo to have a target object
    const runtime = ThreadRuntime.fromThread(t);
    const todoRef = await runtime.instantiate({
      class: "_builtin/agent/todo",
      args: { content: "demo" },
    });
    // Now open a form for one of todo's methods. todo has no methods of its own,
    // so use the thread itself as target (it has 'say' method).
    const threadRef = t.contextWindows.find((w) => w.class === "_builtin/agent/thread")
      ?? { id: t.id, class: "_builtin/agent/thread", createdAt: Date.now() };
    // ensure thread is referenced as a window for open to find
    if (!t.contextWindows.find((w) => w.id === t.id)) {
      t.contextWindows.push({ id: t.id, class: "_builtin/agent/thread", createdAt: Date.now() });
    }

    const want = "I want to greet the user before doing anything else";
    const result = await runtime.open(t.id, "say", want);
    expect(result.refs).toBeDefined();
    expect(result.refs?.length).toBe(1);
    const formRef = result.refs![0]!;
    expect(formRef.class).toBe("_builtin/agent/method_exec_form");

    // Form data should contain the want
    const formInst = reg.getObject(formRef.id);
    expect(formInst).toBeDefined();
    const formData = formInst!.data as FormData;
    expect(formData.want).toBe(want);
    expect(formData.targetObjectId).toBe(t.id);
    expect(formData.guideName).toBe("say");

    // readable render should include a <want> XML node
    const rendered = await renderReadable(formRef, reg, reg);
    expect(rendered.source).toBe("render-fn");
    // payload should be XmlNode[]; serialize and check for <want> tag with the text
    const wrapped = xmlElement("root", {}, Array.isArray(rendered.payload) ? rendered.payload : [xmlText(rendered.payload)]);
    const xmlStr = serializeXml(wrapped);
    expect(xmlStr).toContain("<want>");
    expect(xmlStr).toContain(want);
  });

  it("dispatchToolCall('open') routes through runtime.open", async () => {
    const t = await makeThread();
    if (!t.contextWindows.find((w) => w.id === t.id)) {
      t.contextWindows.push({ id: t.id, class: "_builtin/agent/thread", createdAt: Date.now() });
    }
    const runtime = ThreadRuntime.fromThread(t);
    const out = await dispatchToolCall(
      {
        id: "call-1",
        name: "open",
        arguments: { objectId: t.id, methodName: "say", want: "test want from dispatch" },
      },
      runtime,
      t,
    );
    expect(out.shouldWait).toBe(false);
    expect(out.outputText).toContain("test want from dispatch");
  });
});
