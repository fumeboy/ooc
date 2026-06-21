import { describe, expect, test } from "bun:test";
import { WindowManager } from "../window-manager.js";
import { createObjectRegistry } from "../object-registry.js";
import {
  getSessionObjectTable,
  evictObjectFromTable,
  objectKeyOf,
} from "../session-object-table.js";
import type { OocObjectInstance } from "../ooc-class.js";
import type { ThreadContext } from "../../_shared/types/thread.js";

/**
 * session-object-table —— B→A 回归网：钉死「一 session 一 objectId 一持 data 实例 + window=对它的
 * 共享引用」。结构改动打破任一即红。
 */

const FILE_CLASS = "_builtin/filesystem/file";

const refWin = (id: string, objectId: string, data: unknown): OocObjectInstance => ({
  id,
  title: "t",
  status: "open",
  createdAt: 0,
  object: { class: FILE_CLASS, data },
  objectRef: { objectId, class: FILE_CLASS },
});

const mkThread = (
  id: string,
  windows: OocObjectInstance[],
  parent?: ThreadContext,
): ThreadContext =>
  ({
    id,
    status: "running",
    contextWindows: windows,
    childThreads: {},
    ...(parent ? { _parentThreadRef: parent } : {}),
  }) as unknown as ThreadContext;

describe("session-object-table B→A 不变量", () => {
  test("同 objectId 跨 thread 多窗经 fromThread 解析到同一 object 引用（共享单一实例）", () => {
    const reg = createObjectRegistry();
    const wP = refWin("obj_x", "obj_x", { v: 1 });
    const wC = refWin("obj_x", "obj_x", { v: 1 }); // 另一 thread 对同一 object 的引用
    const parent = mkThread("t_p", [wP]);
    const child = mkThread("t_c", [wC], parent);

    WindowManager.fromThread(parent, reg); // 注册 canonical
    WindowManager.fromThread(child, reg); // 共享同一表项

    expect(wC.object).toBe(wP.object); // 同一引用（非各窗副本）
    expect(getSessionObjectTable(parent).size).toBe(1); // 一 objectId 一 instance
  });

  test("live-ref：经一窗改 object.data，另一窗即见（同一引用）", () => {
    const reg = createObjectRegistry();
    const wP = refWin("obj_y", "obj_y", { n: 1 });
    const wC = refWin("obj_y", "obj_y", { n: 1 });
    const parent = mkThread("t_p", [wP]);
    const child = mkThread("t_c", [wC], parent);
    WindowManager.fromThread(parent, reg);
    WindowManager.fromThread(child, reg);

    (wP.object.data as { n: number }).n = 42;
    expect((wC.object.data as { n: number }).n).toBe(42);
  });

  test("不同 objectId 不误共享", () => {
    const reg = createObjectRegistry();
    const wA = refWin("obj_a", "obj_a", { k: "a" });
    const wB = refWin("obj_b", "obj_b", { k: "b" });
    const t = mkThread("t", [wA, wB]);
    WindowManager.fromThread(t, reg);

    expect(wA.object).not.toBe(wB.object);
    expect(getSessionObjectTable(t).size).toBe(2);
  });

  test("evict 移表项（杜绝悬空共享引用，核心 10）", () => {
    const wA = refWin("obj_z", "obj_z", {});
    const t = mkThread("t", [wA]);
    getSessionObjectTable(t).set("obj_z", wA.object);
    expect(getSessionObjectTable(t).size).toBe(1);

    evictObjectFromTable(t, "obj_z");
    expect(getSessionObjectTable(t).size).toBe(0);
  });

  test("objectKeyOf：独立对象用 objectRef.objectId、无 ref 门面窗回落 id", () => {
    expect(objectKeyOf(refWin("w1", "obj_1", {}))).toBe("obj_1");
    const facade = {
      id: "agent_a",
      title: "t",
      status: "open",
      createdAt: 0,
      object: { class: "agent_a", data: {} },
    } as OocObjectInstance;
    expect(objectKeyOf(facade)).toBe("agent_a");
  });
});
