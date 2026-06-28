/**
 * lifecycle on_reload 派发测试（issue 2026-06-28-lifecycle-module-and-reload Stage B）。
 *
 * 覆盖：
 *  - case A: reloadTable.peek 命中 + cursor 越界 → on_reload 派发；cursor 同步推进
 *  - case B: 重复 active 同 inst 不重复派发（cursor 已 latest）
 *  - case C: 再次 invalidate（registerInvalidation 推进 ts）→ 下次 active 重新派发
 *  - case D: on_reload before active 顺序契约
 *  - case E: 无 reloadTable 注入（tier-A 控制面）静默跳过、不抛
 *  - case F: class 未注册 on_reload 钩 → cursor 推进、不抛
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import { ObjectInsRegistry } from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { createReloadTable } from "@ooc/core/runtime/reload-table";
import { ThreadRuntime } from "@ooc/builtins/agent/children/thread";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types";
import type { OocClass } from "@ooc/core/runtime/ooc-class";

const SESSION = "test-on-reload";

async function makeThread(): Promise<ThreadContext> {
  const reg = getSessionRegistry(SESSION);
  const ctor = reg.resolveConstructor("_builtin/agent/thread")!;
  const data = (await ctor.exec(
    { sessionId: SESSION, worldDir: "", dir: "", args: { calleeObjectId: "_builtin/supervisor" } },
    { calleeObjectId: "_builtin/supervisor", message: "hi" },
  )) as ThreadContext;
  reg.setObject({ id: data.id, class: "_builtin/agent/thread", data });
  return data;
}

/** 注册一个测试 class with active + on_reload + unactive 三钩,统计调用次数。 */
function registerTestClass(): {
  cls: OocClass;
  counters: { active: number; onReload: number; unactive: number; onReloadInfo: { changedFiles?: string[] }[] };
  order: string[];
} {
  const counters = { active: 0, onReload: 0, unactive: 0, onReloadInfo: [] as { changedFiles?: string[] }[] };
  const order: string[] = [];
  const cls: OocClass = {
    id: "_test/reload_target",
    construct: {
      description: "test construct",
      schema: {},
      exec: () => ({ value: 0 }),
    },
    lifecycle: {
      active: {
        description: "test active",
        exec: () => {
          counters.active += 1;
          order.push("active");
        },
      },
      on_reload: {
        description: "test on_reload",
        exec: (_ctx, _self, info) => {
          counters.onReload += 1;
          counters.onReloadInfo.push(info);
          order.push("on_reload");
        },
      },
      unactive: {
        description: "test unactive",
        exec: () => {
          counters.unactive += 1;
          order.push("unactive");
        },
      },
    },
  };
  return { cls, counters, order };
}

describe("lifecycle on_reload dispatch (issue 2026-06-28)", () => {
  beforeEach(() => {
    releaseSessionRegistry(SESSION);
  });
  afterEach(() => {
    releaseSessionRegistry(SESSION);
  });

  it("case A: reloadTable mark + cursor stale → on_reload dispatched + cursor advanced", async () => {
    const reloadTable = createReloadTable();
    const { cls, counters } = registerTestClass();
    const reg = getSessionRegistry(SESSION);
    reg.register(cls);
    reg.setObject({ id: "obj-A", class: cls.id, data: { value: 0 } });
    const t = await makeThread();
    const runtime = new ThreadRuntime(t, reg, { reloadTable });

    reloadTable.registerInvalidation(cls.id, ["src/foo.ts"]);

    // 经 instantiate 路径模拟 first-ref active —— 直接调 private dispatchActive
    // 用反射进入(测试 hook): 实际生产路径由 instantiate 内部触发
    await (runtime as any).dispatchActive("obj-A");

    expect(counters.onReload).toBe(1);
    expect(counters.active).toBe(1);
    expect(counters.onReloadInfo[0]?.changedFiles).toEqual(["src/foo.ts"]);
  });

  it("case B: 重复 active 同 inst 不重派 on_reload", async () => {
    const reloadTable = createReloadTable();
    const { cls, counters } = registerTestClass();
    const reg = getSessionRegistry(SESSION);
    reg.register(cls);
    reg.setObject({ id: "obj-B", class: cls.id, data: {} });
    const t = await makeThread();
    const runtime = new ThreadRuntime(t, reg, { reloadTable });

    reloadTable.registerInvalidation(cls.id);
    await (runtime as any).dispatchActive("obj-B");
    await (runtime as any).dispatchActive("obj-B");
    await (runtime as any).dispatchActive("obj-B");

    expect(counters.onReload).toBe(1); // 仅首次
    expect(counters.active).toBe(3);
  });

  it("case C: 再次 invalidate → 下次 active 重派 on_reload", async () => {
    const reloadTable = createReloadTable();
    const { cls, counters } = registerTestClass();
    const reg = getSessionRegistry(SESSION);
    reg.register(cls);
    reg.setObject({ id: "obj-C", class: cls.id, data: {} });
    const t = await makeThread();
    const runtime = new ThreadRuntime(t, reg, { reloadTable });

    reloadTable.registerInvalidation(cls.id, ["a.ts"]);
    await (runtime as any).dispatchActive("obj-C");
    expect(counters.onReload).toBe(1);

    // 第二次 hot-reload
    reloadTable.registerInvalidation(cls.id, ["b.ts"]);
    await (runtime as any).dispatchActive("obj-C");
    expect(counters.onReload).toBe(2);
    // changedFiles 累积（reloadTable 内部合并 + 第二次 peek 拿到合并集）
    expect(counters.onReloadInfo[1]?.changedFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("case D: on_reload before active 顺序契约", async () => {
    const reloadTable = createReloadTable();
    const { cls, order } = registerTestClass();
    const reg = getSessionRegistry(SESSION);
    reg.register(cls);
    reg.setObject({ id: "obj-D", class: cls.id, data: {} });
    const t = await makeThread();
    const runtime = new ThreadRuntime(t, reg, { reloadTable });

    reloadTable.registerInvalidation(cls.id);
    await (runtime as any).dispatchActive("obj-D");

    // 顺序应为 [on_reload, active]
    expect(order).toEqual(["on_reload", "active"]);
  });

  it("case E: 无 reloadTable 注入（tier-A）→ 静默跳过 on_reload + active 仍跑", async () => {
    const { cls, counters } = registerTestClass();
    const reg = getSessionRegistry(SESSION);
    reg.register(cls);
    reg.setObject({ id: "obj-E", class: cls.id, data: {} });
    const t = await makeThread();
    const runtime = new ThreadRuntime(t, reg, {}); // 无 reloadTable

    await (runtime as any).dispatchActive("obj-E");

    expect(counters.onReload).toBe(0);
    expect(counters.active).toBe(1);
  });

  it("case F: class 未注册 on_reload 钩 → cursor 推进、不抛、active 正常跑", async () => {
    const reloadTable = createReloadTable();
    // 类不带 on_reload 钩(仅 active)
    let activeCalls = 0;
    const cls: OocClass = {
      id: "_test/reload_no_hook",
      construct: { description: "", schema: {}, exec: () => ({}) },
      lifecycle: {
        active: {
          description: "",
          exec: () => {
            activeCalls += 1;
          },
        },
      },
    };
    const reg = getSessionRegistry(SESSION);
    reg.register(cls);
    reg.setObject({ id: "obj-F", class: cls.id, data: {} });
    const t = await makeThread();
    const runtime = new ThreadRuntime(t, reg, { reloadTable });

    reloadTable.registerInvalidation(cls.id);
    await (runtime as any).dispatchActive("obj-F");

    expect(activeCalls).toBe(1);
    // 再次 active 不重跑(cursor 已推进)
    await (runtime as any).dispatchActive("obj-F");
    expect(activeCalls).toBe(2); // active 每次都跑
    // 第二次 reloadTable peek 仍同 ts → cursor 已记，不重派
    reloadTable.registerInvalidation(cls.id);
    await (runtime as any).dispatchActive("obj-F");
    expect(activeCalls).toBe(3);
  });
});
