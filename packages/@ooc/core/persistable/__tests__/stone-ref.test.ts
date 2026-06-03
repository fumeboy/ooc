import { describe, expect, test } from "bun:test";
import { packageDir, stoneDir, deriveStoneFromThread, type StoneObjectRef, type ThreadPersistenceRef } from "../common";

// M2 (2026-06-03): "packages/" renamed to "stones/" as canonical user-stone path.
// stoneDir is now canonical; packageDir is a @deprecated alias that delegates to stoneDir.
describe("stoneDir resolves stones/{nestedPath(objectId)}", () => {
  test("flat objectId resolves to stones/<id>", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "agent_of_x" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/agent_of_x");
  });

  test("nested objectId inserts children/ segments", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "sentry/sentry_factor_dev" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/sentry/children/sentry_factor_dev");
  });

  test("deeply nested objectId inserts multiple children/ segments", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "a/b/c" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/a/children/b/children/c");
  });

  test("packageDir is a deprecated alias for stoneDir", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "agent_of_x" };
    expect(packageDir(ref)).toBe(stoneDir(ref));
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
    expect(stoneDir(stoneRef)).toBe("/tmp/world/stones/agent_of_x");
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
    expect(stoneDir(stoneRef)).toBe("/tmp/world/stones/a/children/b");
  });
});
