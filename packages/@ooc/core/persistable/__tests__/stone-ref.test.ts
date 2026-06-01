import { describe, expect, test } from "bun:test";
import { packageDir, stoneDir, deriveStoneFromThread, type StoneObjectRef, type ThreadPersistenceRef } from "../common";

describe("packageDir resolves packages/{nestedPath(objectId)}", () => {
  test("flat objectId resolves to packages/<id>", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "agent_of_x" };
    expect(packageDir(ref)).toBe("/tmp/world/packages/agent_of_x");
  });

  test("nested objectId inserts children/ segments", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "sentry/sentry_factor_dev" };
    expect(packageDir(ref)).toBe("/tmp/world/packages/sentry/children/sentry_factor_dev");
  });

  test("deeply nested objectId inserts multiple children/ segments", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "a/b/c" };
    expect(packageDir(ref)).toBe("/tmp/world/packages/a/children/b/children/c");
  });

  test("stoneDir is an alias for packageDir", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "agent_of_x" };
    expect(stoneDir(ref)).toBe(packageDir(ref));
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
    expect(packageDir(stoneRef)).toBe("/tmp/world/packages/agent_of_x");
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
    expect(packageDir(stoneRef)).toBe("/tmp/world/packages/a/children/b");
  });
});
