import { describe, expect, it } from "bun:test";
import { togglePinned } from "./pinned-sessions";

describe("togglePinned", () => {
  it("adds a session id when not pinned", () => {
    expect(togglePinned([], "s1")).toEqual(["s1"]);
    expect(togglePinned(["s1"], "s2")).toEqual(["s1", "s2"]);
  });

  it("removes a session id when already pinned", () => {
    expect(togglePinned(["s1", "s2"], "s1")).toEqual(["s2"]);
    expect(togglePinned(["s1"], "s1")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = ["s1"];
    togglePinned(input, "s2");
    expect(input).toEqual(["s1"]);
    togglePinned(input, "s1");
    expect(input).toEqual(["s1"]);
  });
});
