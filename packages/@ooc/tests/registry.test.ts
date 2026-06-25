/**
 * core registry smoke test —— 验证 ClassRegistry / ObjectInsRegistry 的最小语义。
 */
import { describe, it, expect } from "bun:test";
import {
  ClassRegistry,
  ObjectInsRegistry,
  builtinClassRegistry,
  getSessionRegistry,
  releaseSessionRegistry,
  iterateSessionObjectTable,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { THREAD_CLASS_ID } from "@ooc/core/types/constants";

describe("ClassRegistry", () => {
  it("registers builtin classes", () => {
    expect(builtinClassRegistry.hasClass(THREAD_CLASS_ID)).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/agent")).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/agent/todo")).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/agent/plan")).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/agent/skill_index")).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/agent/method_exec_form")).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/agent/pr")).toBe(true);
    expect(builtinClassRegistry.hasClass("_builtin/filesystem")).toBe(true);
  });

  it("resolves construct + methods on registered classes", () => {
    expect(builtinClassRegistry.resolveConstructor(THREAD_CLASS_ID)).toBeDefined();
    expect(builtinClassRegistry.resolveObjectMethod("_builtin/agent", "talk")).toBeDefined();
    expect(builtinClassRegistry.resolveObjectMethod("_builtin/agent/todo", "done")).toBeDefined();
  });

  it("returns undefined for unknown class / method", () => {
    expect(builtinClassRegistry.getClass("_nonexistent")).toBeUndefined();
    expect(builtinClassRegistry.resolveObjectMethod("_builtin/agent", "nonexistent")).toBeUndefined();
  });
});

describe("ObjectInsRegistry / session table", () => {
  it("registers + retrieves object instances per session", () => {
    const sid = "test-session-1";
    const reg = getSessionRegistry(sid);
    reg.setObject({ id: "obj1", class: "_builtin/agent/todo", data: { content: "x", status: "open", createdAt: 0 } });
    expect(reg.getObject("obj1")?.data).toMatchObject({ content: "x" });
    releaseSessionRegistry(sid);
    // After release, new register starts empty
    expect(getSessionRegistry(sid).getObject("obj1")).toBeUndefined();
    releaseSessionRegistry(sid);
  });

  it("iterateSessionObjectTable visits all instances", () => {
    const sid = "test-session-2";
    const reg = getSessionRegistry(sid);
    reg.setObject({ id: "a", class: "x", data: {} });
    reg.setObject({ id: "b", class: "y", data: {} });
    const ids: string[] = [];
    iterateSessionObjectTable(sid, (inst) => ids.push(inst.id));
    expect(ids.sort()).toEqual(["a", "b"]);
    releaseSessionRegistry(sid);
  });
});
