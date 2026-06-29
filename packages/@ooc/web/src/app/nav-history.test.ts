import { describe, expect, it } from "bun:test";
import { pushHistory, MAX_HISTORY } from "./nav-history";

describe("pushHistory", () => {
  it("prepends a new path", () => {
    expect(pushHistory(["/stones"], "/flows/index")).toEqual(["/flows/index", "/stones"]);
  });

  it("dedupes: moving an existing path to the front", () => {
    expect(pushHistory(["/a", "/b", "/c"], "/c")).toEqual(["/c", "/a", "/b"]);
  });

  it("keeps newest first across repeated pushes", () => {
    let h: string[] = [];
    h = pushHistory(h, "/a");
    h = pushHistory(h, "/b");
    h = pushHistory(h, "/c");
    expect(h).toEqual(["/c", "/b", "/a"]);
  });

  it("caps at MAX_HISTORY entries", () => {
    let h: string[] = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) h = pushHistory(h, `/p${i}`);
    expect(h.length).toBe(MAX_HISTORY);
    // newest first → most recent push is at index 0
    expect(h[0]).toBe(`/p${MAX_HISTORY + 4}`);
  });

  it("ignores blank paths", () => {
    expect(pushHistory(["/a"], "")).toEqual(["/a"]);
    expect(pushHistory(["/a"], "   ")).toEqual(["/a"]);
  });

  it("trims path whitespace before recording", () => {
    expect(pushHistory([], "  /flows  ")).toEqual(["/flows"]);
  });

  it("does not mutate the input array", () => {
    const input = ["/a", "/b"];
    pushHistory(input, "/c");
    expect(input).toEqual(["/a", "/b"]);
  });
});
