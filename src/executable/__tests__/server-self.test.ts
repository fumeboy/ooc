import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, readFlowData, writeExecutableSource } from "../../persistable";
import { createProgramSelf } from "../server/self";
import { clearServerLoaderCache } from "../server/loader";
import type { ThreadContext } from "../../thinkable/context";
import { makeThread } from "../../__tests__/make-thread";
import { customWindowIdOf } from "../windows/_shared/types";
// 触发 custom dispatcher 注册
import "../windows/custom/index";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

describe("createProgramSelf", () => {
  test("callMethod resolves and runs custom method on the self window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeExecutableSource(
      ref,
      `export const window = {
        title: "alice",
        methods: {
          whoAmI: {
            paths: ["whoAmI"],
            match: () => ["whoAmI"],
            exec: async (ctx) => ({ ok: true, result: ctx.self.dir + "::" + ctx.thread.id }),
          },
        },
      };
      export const ui_methods = {};`,
    );

    const thread: ThreadContext = makeThread({ id: "t1" });
    const customId = customWindowIdOf("alice");
    thread.contextWindows.push({
      id: customId,
      type: "custom",
      title: "alice",
      status: "open",
      createdAt: Date.now(),
      objectId: "alice",
    });
    thread.persistence = {
      baseDir: tempRoot!,
      sessionId: "s1",
      objectId: "alice",
      threadId: "t1",
    };

    const self = createProgramSelf(ref, thread);
    const result = await self.callMethod(customId, "whoAmI", {});
    expect(typeof result).toBe("object");
    const outcome = result as { ok: boolean; result: string };
    expect(outcome.result).toContain(ref.objectId);
    expect(outcome.result).toContain("t1");
  });

  test("callMethod throws when method not found on the self window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeExecutableSource(
      ref,
      `export const window = { methods: {} }; export const ui_methods = {};`,
    );
    const thread: ThreadContext = makeThread({ id: "t1" });
    const customId = customWindowIdOf("alice");
    thread.contextWindows.push({
      id: customId,
      type: "custom",
      title: "alice",
      status: "open",
      createdAt: Date.now(),
      objectId: "alice",
    });
    thread.persistence = {
      baseDir: tempRoot!,
      sessionId: "s1",
      objectId: "alice",
      threadId: "t1",
    };
    const self = createProgramSelf(ref, thread);
    await expect(self.callMethod(customId, "nope", {})).rejects.toThrow(/不存在/);
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
