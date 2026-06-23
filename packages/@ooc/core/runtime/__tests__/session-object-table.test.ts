import { describe, expect, test } from "bun:test";
import {
  getSessionObjectTable,
  getSessionObject,
  setSessionObject,
  evictObjectFromTable,
  materializeWindow,
} from "../session-object-table.js";
import { objectDataOf } from "../../_shared/types/context-window.js";
import type { OocObjectRef } from "../ooc-class.js";
import type { ThreadContext } from "@ooc/builtins/agent/thread/types.js";

/**
 * session-object-table —— B→A 回归网：钉死「一 session 一 objectId 一持 data 实例 + window=对它的
 * 引用（不持 data）」。data 的唯一内存归宿是表（挂内存线程树**根**、按 objectId 键）；窗（OocObjectRef）
 * 只持 id(=objectId)+缓存 class+视角态。结构改动打破任一即红。
 */

const FILE_CLASS = "_builtin/filesystem/file";

const refWin = (id: string): OocObjectRef => ({
  id,
  class: FILE_CLASS,
  title: "t",
  status: "open",
  createdAt: 0,
  objectRef: { objectId: id, class: FILE_CLASS },
});

const mkThread = (
  id: string,
  windows: OocObjectRef[],
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
  test("表挂内存线程树根：子 thread 取表解析到与父同一份（session 作用域）", () => {
    const wP = refWin("obj_x");
    const wC = refWin("obj_x"); // 另一 thread 对同一 object 的引用
    const parent = mkThread("t_p", [wP]);
    const child = mkThread("t_c", [wC], parent);

    setSessionObject(parent, { id: "obj_x", class: FILE_CLASS, data: { v: 1 } });

    // 父子取到同一份表（挂根），故子窗也解析到父登记的实例（一 objectId 一 instance）。
    expect(getSessionObjectTable(child)).toBe(getSessionObjectTable(parent));
    expect(getSessionObject(child, "obj_x")).toBe(getSessionObject(parent, "obj_x"));
    expect(getSessionObjectTable(parent).size).toBe(1);
  });

  test("live-ref：经一窗改 object data，另一窗（同 objectId）即见（解析到同一实例）", () => {
    const wP = refWin("obj_y");
    const wC = refWin("obj_y");
    const parent = mkThread("t_p", [wP]);
    const child = mkThread("t_c", [wC], parent);
    setSessionObject(parent, { id: "obj_y", class: FILE_CLASS, data: { n: 1 } });

    const tableP = getSessionObjectTable(parent);
    const tableC = getSessionObjectTable(child);
    (objectDataOf(wP, tableP) as { n: number }).n = 42;
    expect((objectDataOf(wC, tableC) as { n: number }).n).toBe(42);
  });

  test("不同 objectId 不误共享", () => {
    const wA = refWin("obj_a");
    const wB = refWin("obj_b");
    const t = mkThread("t", [wA, wB]);
    setSessionObject(t, { id: "obj_a", class: FILE_CLASS, data: { k: "a" } });
    setSessionObject(t, { id: "obj_b", class: FILE_CLASS, data: { k: "b" } });

    const table = getSessionObjectTable(t);
    expect(getSessionObject(t, "obj_a")).not.toBe(getSessionObject(t, "obj_b"));
    expect(objectDataOf(wA, table)).not.toBe(objectDataOf(wB, table));
    expect(table.size).toBe(2);
  });

  test("evict 移表项（杜绝悬空引用，核心 10）", () => {
    const wA = refWin("obj_z");
    const t = mkThread("t", [wA]);
    setSessionObject(t, { id: "obj_z", class: FILE_CLASS, data: {} });
    expect(getSessionObjectTable(t).size).toBe(1);

    evictObjectFromTable(t, "obj_z");
    expect(getSessionObjectTable(t).size).toBe(0);
    expect(getSessionObject(t, "obj_z")).toBeUndefined();
  });

  test("materializeWindow：data 入表、返回纯 ref（窗不持 data）", () => {
    const t = mkThread("t", []);
    const w = materializeWindow(t, {
      id: "obj_m",
      class: FILE_CLASS,
      data: { hello: "world" },
      title: "t",
      status: "open",
      createdAt: 0,
    });
    // 返回的窗是纯 ref：不含 data 字段。
    expect((w as unknown as Record<string, unknown>).data).toBeUndefined();
    expect(w.id).toBe("obj_m");
    expect(w.class).toBe(FILE_CLASS);
    // data 进了对象表，经 objectDataOf 解析得到。
    expect(objectDataOf<{ hello: string }>(w, getSessionObjectTable(t))).toEqual({
      hello: "world",
    });
  });
});
