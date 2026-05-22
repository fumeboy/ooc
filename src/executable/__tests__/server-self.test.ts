import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createStoneObject, readData, writeServerSource } from "../../persistable";
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
  test("callCommand resolves and runs custom command on the self window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });

    await writeServerSource(
      ref,
      `export const window = {
        title: "alice",
        commands: {
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
    const result = await self.callCommand(customId, "whoAmI", {});
    expect(typeof result).toBe("object");
    const outcome = result as { ok: boolean; result: string };
    expect(outcome.result).toContain(ref.objectId);
    expect(outcome.result).toContain("t1");
  });

  test("callCommand throws when command not found on the self window", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-self-"));
    const ref = await createStoneObject({ baseDir: tempRoot, objectId: "alice" });
    await writeServerSource(
      ref,
      `export const window = { commands: {} }; export const ui_methods = {};`,
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
    await expect(self.callCommand(customId, "nope", {})).rejects.toThrow(/不存在/);
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
});
