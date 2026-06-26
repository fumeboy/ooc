/**
 * dispatch-guide-form test —— 验证 issue 2026-06-26-object-guide-method-split 落地的 dispatch 分流：
 *
 *   1. 调一个 stub class 的 guide method → ThreadRuntime.exec 返回 form ref（refs 含新建的
 *      method_exec_form 对象 id）；form 对象 data 含 guideName / targetObjectId /
 *      accumulatedArgs / currentTip / currentIntents。
 *   2. 对 form 调 refine → form data 更新（route 重跑出新 tip/intents）。
 *   3. 对 form 调 submit → guide.exec 真被调用（副作用观察：stub 内部计数器自增）。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { ThreadRuntime } from "@ooc/builtins/agent/children/thread";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type {
  ObjectGuideMethod,
  ObjectMethodIntents,
} from "@ooc/core/types/index";
import type { OocClass } from "@ooc/core/runtime/ooc-class";

const SESSION = "_test_dispatch_guide_form";
const STUB_CLASS_ID = "test/guide-stub";

interface StubData {
  name: string;
  execCount: number;
  lastArgs: Record<string, unknown>;
}

// route 行为：传 `quick: true` → quickSubmit=true；否则按 args.x 是否存在调 tip/intents
const guide: ObjectGuideMethod<StubData> = {
  name: "do_thing",
  description: "stub guide",
  intents: [
    { name: "intent.thing.start", description: "" },
    { name: "intent.thing.finish", description: "" },
  ],
  route: (_ctx, _self, args: { x?: number; quick?: boolean }): ObjectMethodIntents => {
    if (args?.quick) return { quickSubmit: true };
    if (args?.x !== undefined) {
      return { tip: `got x=${args.x}; please pass y`, intents: ["intent.thing.finish"] };
    }
    return { tip: "please pass x", intents: ["intent.thing.start"] };
  },
  exec: (_ctx, self, args: Record<string, unknown>) => {
    self.data.execCount += 1;
    self.data.lastArgs = args;
    return { message: `executed with ${JSON.stringify(args)}` };
  },
};

const StubClass: OocClass<StubData> = {
  id: STUB_CLASS_ID,
  construct: {
    description: "stub",
    exec: (): StubData => ({ name: "s", execCount: 0, lastArgs: {} }),
  },
  executable: { methods: [], guides: [guide] },
  readable: {
    readable: () => ({ class: "default", content: "" }),
    window: [
      {
        class: "default",
        object_methods: [],
        guide_methods: ["do_thing"],
        window_methods: [],
      },
    ],
  },
};

async function makeThread(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION);
  reg.register(StubClass);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId: SESSION, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hello" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

describe("ThreadRuntime guide dispatch → method_exec_form", () => {
  beforeEach(() => {
    releaseSessionRegistry(SESSION);
  });
  afterEach(() => {
    releaseSessionRegistry(SESSION);
  });

  it("dispatching a guide name opens a method_exec_form with proper data", async () => {
    const t = await makeThread();
    const runtime = ThreadRuntime.fromThread(t);
    const stubRef = await runtime.instantiate({ class: STUB_CLASS_ID });

    const result = await runtime.exec(stubRef.id, "do_thing", {});
    expect(result.refs).toBeDefined();
    expect(result.refs?.length).toBe(1);
    const formRef = result.refs![0]!;
    expect(formRef.class).toBe("_builtin/agent/method_exec_form");
    expect(result.message).toContain("已开启表单");

    const reg = getSessionRegistry(SESSION);
    const formInst = reg.getObject(formRef.id);
    expect(formInst).toBeDefined();
    const fd = formInst!.data as {
      targetObjectId: string;
      guideName: string;
      accumulatedArgs: Record<string, unknown>;
      currentTip?: string;
      currentIntents?: string[];
    };
    expect(fd.targetObjectId).toBe(stubRef.id);
    expect(fd.guideName).toBe("do_thing");
    expect(fd.currentTip).toBe("please pass x");
    expect(fd.currentIntents).toEqual(["intent.thing.start"]);
  });

  it("refine on form updates tip/intents via route re-run", async () => {
    const t = await makeThread();
    const runtime = ThreadRuntime.fromThread(t);
    const stubRef = await runtime.instantiate({ class: STUB_CLASS_ID });
    const r0 = await runtime.exec(stubRef.id, "do_thing", {});
    const formRef = r0.refs![0]!;

    await runtime.exec(formRef.id, "refine", { args: { x: 42 } });

    const reg = getSessionRegistry(SESSION);
    const fd = reg.getObject(formRef.id)!.data as {
      accumulatedArgs: Record<string, unknown>;
      currentTip?: string;
      currentIntents?: string[];
    };
    expect(fd.accumulatedArgs).toEqual({ x: 42 });
    expect(fd.currentTip).toBe("got x=42; please pass y");
    expect(fd.currentIntents).toEqual(["intent.thing.finish"]);
  });

  it("submit on form invokes guide.exec with accumulated args", async () => {
    const t = await makeThread();
    const runtime = ThreadRuntime.fromThread(t);
    const stubRef = await runtime.instantiate({ class: STUB_CLASS_ID });
    const r0 = await runtime.exec(stubRef.id, "do_thing", {});
    const formRef = r0.refs![0]!;
    await runtime.exec(formRef.id, "refine", { args: { x: 1 } });
    await runtime.exec(formRef.id, "refine", { args: { y: 2 } });

    const submitResult = await runtime.exec(formRef.id, "submit", {});
    expect(submitResult.message).toContain("executed with");

    const reg = getSessionRegistry(SESSION);
    const stubData = reg.getObject(stubRef.id)!.data as StubData;
    expect(stubData.execCount).toBe(1);
    expect(stubData.lastArgs).toEqual({ x: 1, y: 2 });
  });

  it("guide with quickSubmit=true runs guide.exec directly (no form)", async () => {
    const t = await makeThread();
    const runtime = ThreadRuntime.fromThread(t);
    const stubRef = await runtime.instantiate({ class: STUB_CLASS_ID });

    const result = await runtime.exec(stubRef.id, "do_thing", { quick: true });
    expect(result.refs).toBeUndefined();
    expect(result.message).toContain("executed with");

    const reg = getSessionRegistry(SESSION);
    const stubData = reg.getObject(stubRef.id)!.data as StubData;
    expect(stubData.execCount).toBe(1);
    expect(stubData.lastArgs).toEqual({ quick: true });
  });
});
