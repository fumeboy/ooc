import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, readFlowData, writeExecutableSource } from "../../persistable";
import { createProgramSelf } from "../object/self";
import { clearServerLoaderCache } from "@ooc/core/runtime/server-loader";
import type { ThreadContext } from "../../thinkable/context";
import { makeThread } from "../../__tests__/make-thread";
import { loadObjectWindow } from "@ooc/core/runtime/server-loader";
import { builtinRegistry } from "../windows/_shared/registry";
import type { ContextWindow } from "../windows/_shared/types";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

describe("createProgramSelf", () => {
  test("callMethod resolves and runs custom command on the self window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeExecutableSource(
      ref,
      `export const window = {
        title: "alice",
        methods: {
          whoAmI: {
            paths: ["whoAmI"],
            intent: () => [],
            exec: async (ctx) => ({ ok: true, result: ctx.programSelf.dir + "::" + ctx.thread.id }),
          },
        },
      };
      export const ui_methods = {};`,
    );

    const thread: ThreadContext = makeThread({ id: "t1" });
    // ooc-6 new design: window id = object id, window type = object id
    const objectId = "alice";
    // Load and register the object window definition dynamically
    const objWin = await loadObjectWindow(ref);
    if (!builtinRegistry.listRegisteredObjectTypes().includes(objectId as any) && objWin) {
      builtinRegistry.registerNewObjectType(objectId as any, {
        methods: objWin.methods ?? {},
        renderXml: objWin.renderXml,
        readable: objWin.readable,
        onClose: objWin.onClose,
        basicKnowledge: typeof objWin.basicKnowledge === "string" ? objWin.basicKnowledge : undefined,
        parentClass: objWin?.parentClass,
      });
    }
    thread.contextWindows.push({
      id: objectId,
      type: objectId as any,
      title: "alice",
      status: "open",
      createdAt: Date.now(),
    } as ContextWindow);
    thread.persistence = {
      baseDir: tempRoot!,
      sessionId: "s1",
      objectId: "alice",
      threadId: "t1",
    };

    const self = createProgramSelf(ref, thread);
    const result = await self.callMethod(objectId, "whoAmI", {});
    expect(typeof result).toBe("object");
    const outcome = result as { ok: boolean; result: string };
    expect(outcome.result).toContain(ref.objectId);
    expect(outcome.result).toContain("t1");
  });

  test("callMethod throws when command not found on the self window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeExecutableSource(
      ref,
      `export const window = { commands: {} }; export const ui_methods = {};`,
    );
    const thread: ThreadContext = makeThread({ id: "t1" });
    // ooc-6 new design: window id = object id, window type = object id
    const objectId = "alice";
    // Load and register the object window definition dynamically
    const objWin = await loadObjectWindow(ref);
    if (!builtinRegistry.listRegisteredObjectTypes().includes(objectId as any) && objWin) {
      builtinRegistry.registerNewObjectType(objectId as any, {
        methods: objWin.methods ?? {},
        renderXml: objWin.renderXml,
        readable: objWin.readable,
        onClose: objWin.onClose,
        basicKnowledge: typeof objWin.basicKnowledge === "string" ? objWin.basicKnowledge : undefined,
        parentClass: objWin?.parentClass,
      });
    }
    thread.contextWindows.push({
      id: objectId,
      type: objectId as any,
      title: "alice",
      status: "open",
      createdAt: Date.now(),
    } as ContextWindow);
    thread.persistence = {
      baseDir: tempRoot!,
      sessionId: "s1",
      objectId: "alice",
      threadId: "t1",
    };
    const self = createProgramSelf(ref, thread);
    await expect(self.callMethod(objectId, "nope", {})).rejects.toThrow(/不存在/);
  });

  test("setData/getData round trip via flow-data mergeData (session-scoped)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    const thread: ThreadContext = makeThread({ id: "t1" });
    // 2026-05-23: getData/setData 现在是 session-scoped，需要 thread.persistence。
    thread.persistence = {
      baseDir: tempRoot!,
      sessionId: "s1",
      objectId: "alice",
      threadId: "t1",
    };
    const self = createProgramSelf(ref, thread);

    expect(await self.getData("counter")).toBeUndefined();
    await self.setData("counter", 1);
    expect(await self.getData("counter")).toBe(1);
    await self.setData("counter", 2);
    expect(await self.getData("counter")).toBe(2);
    expect(await readFlowData(thread.persistence)).toEqual({ counter: 2 });
  });

  test("getData / setData no-op when thread.persistence missing", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    const thread: ThreadContext = makeThread({ id: "t1" });
    // 故意不设 persistence
    const self = createProgramSelf(ref, thread);

    expect(await self.getData("anything")).toBeUndefined();
    // setData no-op；不抛错
    await self.setData("foo", "bar");
    expect(await self.getData("foo")).toBeUndefined();
  });
});
