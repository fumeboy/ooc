import { describe, expect, test } from "bun:test";
import { stoneDir, deriveStoneFromThread, type StoneObjectRef, type ThreadPersistenceRef } from "../common";
import { STONES_MAIN_BRANCH } from "../stone-bootstrap";

describe("stoneDir resolves stones/{branch}/objects/{objectId}", () => {
  test("defaults to main when stonesBranch is undefined", () => {
    const ref: StoneObjectRef = { baseDir: "/tmp/world", objectId: "agent_of_x" };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/main/objects/agent_of_x");
  });

  test("explicit stonesBranch composes correctly", () => {
    const ref: StoneObjectRef = {
      baseDir: "/tmp/world",
      objectId: "agent_of_x",
      stonesBranch: "metaprog-agent_of_x-abc123",
    };
    expect(stoneDir(ref)).toBe("/tmp/world/stones/metaprog-agent_of_x-abc123/objects/agent_of_x");
  });

  test("STONES_MAIN_BRANCH constant is 'main'", () => {
    expect(STONES_MAIN_BRANCH).toBe("main");
  });
});

describe("deriveStoneFromThread", () => {
  test("propagates stonesBranch from thread persistence", () => {
    const threadRef: ThreadPersistenceRef = {
      baseDir: "/tmp/world",
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "root",
      stonesBranch: "metaprog-foo",
    };
    const stoneRef = deriveStoneFromThread(threadRef);
    expect(stoneRef).toEqual({
      baseDir: "/tmp/world",
      objectId: "agent_of_x",
      stonesBranch: "metaprog-foo",
    });
    expect(stoneDir(stoneRef)).toBe("/tmp/world/stones/metaprog-foo/objects/agent_of_x");
  });

  test("absent stonesBranch survives roundtrip and resolves to main", () => {
    const threadRef: ThreadPersistenceRef = {
      baseDir: "/tmp/world",
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "root",
    };
    const stoneRef = deriveStoneFromThread(threadRef);
    expect(stoneRef.stonesBranch).toBeUndefined();
    expect(stoneDir(stoneRef)).toBe("/tmp/world/stones/main/objects/agent_of_x");
  });
});
