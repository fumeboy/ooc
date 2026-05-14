import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, readData, writeServerSource } from "../../persistable";
import { createProgramSelf } from "../server/self";
import { clearServerLoaderCache } from "../server/loader";
import type { ThreadContext } from "../../thinkable/context";
import { makeThread } from "../../__tests__/make-thread";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearServerLoaderCache();
});

describe("createProgramSelf", () => {
  test("callMethod resolves and runs registered method with ctx.self/thread", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeServerSource(
      ref,
      `export const llm_methods = {
        whoAmI: {
          fn: async (ctx) => ctx.self.dir + "::" + ctx.thread.id,
        },
      };`
    );

    const thread: ThreadContext = makeThread({ id: "t1" });
    const self = createProgramSelf(ref, thread);
    const result = await self.callMethod("whoAmI", {});
    expect(typeof result).toBe("string");
    expect(result).toContain(ref.objectId);
    expect(result).toContain("t1");
  });

  test("callMethod throws clear error for unknown method", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    const thread: ThreadContext = makeThread({ id: "t1" });
    const self = createProgramSelf(ref, thread);
    await expect(self.callMethod("nope", {})).rejects.toThrow(/不存在/);
  });

  test("setData/getData round trip via mergeData", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    const thread: ThreadContext = makeThread({ id: "t1" });
    const self = createProgramSelf(ref, thread);

    expect(await self.getData("counter")).toBeUndefined();
    await self.setData("counter", 1);
    expect(await self.getData("counter")).toBe(1);
    await self.setData("counter", 2);
    expect(await self.getData("counter")).toBe(2);
    expect(await readData(ref)).toEqual({ counter: 2 });
  });

  test("inject pushes context_change/inject event to thread", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeServerSource(
      ref,
      `export const llm_methods = {
        say: {
          fn: async (ctx, { text }) => { ctx.thread.inject(text); return "ok"; },
        },
      };`
    );

    const thread: ThreadContext = makeThread({ id: "t1" });
    const self = createProgramSelf(ref, thread);
    await self.callMethod("say", { text: "from method" });
    expect(thread.events.length).toBe(1);
    expect(thread.events[0]).toEqual({
      category: "context_change",
      kind: "inject",
      text: "from method"
    });
  });
});
