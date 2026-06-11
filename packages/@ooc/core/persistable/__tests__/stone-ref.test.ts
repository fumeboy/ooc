import { describe, expect, test } from "bun:test";
import { stoneDir, deriveStoneFromThread, type StoneObjectRef, type ThreadPersistenceRef } from "../common";

// "packages/" renamed to "stones/" as canonical user-stone path.
describe("stoneDir resolves stones/{nestedPath(objectId)}", () => {
  test("flat objectId resolves to stones/<id>", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "agent_of_x" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/main/objects/agent_of_x");
  });

  test("nested objectId inserts children/ segments", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "sentry/sentry_factor_dev" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/main/objects/sentry/children/sentry_factor_dev");
  });

  test("deeply nested objectId inserts multiple children/ segments", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "a/b/c" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/main/objects/a/children/b/children/c");
  });
});

describe("deriveStoneFromThread", () => {
  test("derives StoneObjectRef from ThreadPersistenceRef (no stonesBranch)", () => {
    const threadRef: ThreadPersistenceRef = {
      baseDir: "/tmp/world",
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "root",
    };
    const stoneRef = deriveStoneFromThread(threadRef);
    expect(stoneRef).toEqual({
      baseDir: "/tmp/world",
      objectId: "agent_of_x",
    });
    expect(stoneDir(stoneRef)).toBe("/tmp/world/stones/main/objects/agent_of_x");
  });

  test("nested threadRef derives correctly", () => {
    const threadRef: ThreadPersistenceRef = {
      baseDir: "/tmp/world",
      sessionId: "s1",
      objectId: "a/b",
      threadId: "root",
    };
    const stoneRef = deriveStoneFromThread(threadRef);
    expect(stoneRef).toEqual({ baseDir: "/tmp/world", objectId: "a/b" });
    expect(stoneDir(stoneRef)).toBe("/tmp/world/stones/main/objects/a/children/b");
  });
});
