import { describe, expect, it } from "bun:test";
import { parseRoute, toPath } from "./routing";

describe("toPath: thread context as query string", () => {
  it("session without thread → bare path", () => {
    expect(toPath({ kind: "session", sessionId: "s1" })).toBe("/flows/s1");
  });
  it("session with thread → query params", () => {
    expect(
      toPath({ kind: "session", sessionId: "s1", objectId: "user", threadId: "root" }),
    ).toBe("/flows/s1?objectId=user&threadId=root");
  });
  it("file without thread", () => {
    expect(toPath({ kind: "file", path: "stones/main/agent_of_x/self.md" })).toBe(
      "/files/stones/main/agent_of_x/self.md",
    );
  });
  it("file with thread context attaches sessionId/objectId/threadId", () => {
    expect(
      toPath({
        kind: "file",
        path: "flows/s1/objects/agent_of_x/files/foo.md",
        thread: { sessionId: "s1", objectId: "agent_of_x", threadId: "t1" },
      }),
    ).toBe(
      "/files/flows/s1/objects/agent_of_x/files/foo.md?sessionId=s1&objectId=agent_of_x&threadId=t1",
    );
  });
  it("encodes special characters in query values", () => {
    const got = toPath({
      kind: "session",
      sessionId: "s1",
      objectId: "obj/with slash",
      threadId: "t&id",
    });
    expect(got).toBe("/flows/s1?objectId=obj%2Fwith%20slash&threadId=t%26id");
  });
});

describe("parseRoute: query string → thread context", () => {
  it("/flows/s1 → bare session", () => {
    const r = parseRoute("/flows/s1", "", { sessionId: "s1" });
    expect(r).toEqual({ kind: "session", sessionId: "s1" });
  });
  it("/flows/s1?objectId=&threadId= → session with thread", () => {
    const r = parseRoute("/flows/s1", "?objectId=user&threadId=root", { sessionId: "s1" });
    expect(r).toEqual({
      kind: "session",
      sessionId: "s1",
      objectId: "user",
      threadId: "root",
    });
  });
  it("session falls back to bare when only one of obj/thread present", () => {
    const r = parseRoute("/flows/s1", "?objectId=user", { sessionId: "s1" });
    expect(r).toEqual({ kind: "session", sessionId: "s1" });
  });
  it("/files/<path>?sessionId=&objectId=&threadId= → file with thread", () => {
    const r = parseRoute(
      "/files/flows/s1/objects/x/files/foo.md",
      "?sessionId=s1&objectId=x&threadId=t1",
    );
    expect(r).toEqual({
      kind: "file",
      path: "flows/s1/objects/x/files/foo.md",
      thread: { sessionId: "s1", objectId: "x", threadId: "t1" },
    });
  });
  it("/files/<path> without query → bare file route", () => {
    const r = parseRoute("/files/stones/main/agent_of_x/self.md", "");
    expect(r).toEqual({ kind: "file", path: "stones/main/agent_of_x/self.md" });
  });
});

describe("parseRoute: legacy /threads/ path stays parseable as session+thread", () => {
  it("old path → session with thread context (no kind: thread)", () => {
    const r = parseRoute("/flows/s1/threads/agent_of_x/t1", "", {
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "t1",
    });
    expect(r).toEqual({
      kind: "session",
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "t1",
    });
  });
});

/**
 * 2026-05-26 user-home 双栏：?selected=chat:<wid> / issue:<id> 在 session 路由
 * 内 round-trip 必须无损；解析失败时 silently 丢弃（不报错），其它 query 字段不受影响。
 */
describe("session ?selected= round-trip", () => {
  it("toPath embeds chat selection", () => {
    expect(
      toPath({ kind: "session", sessionId: "s1", selected: { kind: "chat", windowId: "w_talk_abc" } }),
    ).toBe("/flows/s1?selected=chat%3Aw_talk_abc");
  });
  it("toPath embeds issue selection", () => {
    expect(
      toPath({ kind: "session", sessionId: "s1", selected: { kind: "issue", issueId: 42 } }),
    ).toBe("/flows/s1?selected=issue%3A42");
  });
  it("toPath combines thread query with selected", () => {
    expect(
      toPath({
        kind: "session",
        sessionId: "s1",
        objectId: "user",
        threadId: "root",
        selected: { kind: "chat", windowId: "w_talk_x" },
      }),
    ).toBe("/flows/s1?objectId=user&threadId=root&selected=chat%3Aw_talk_x");
  });
  it("parseRoute reads chat selection", () => {
    const r = parseRoute("/flows/s1", "?selected=chat:w_talk_abc", { sessionId: "s1" });
    expect(r).toEqual({
      kind: "session",
      sessionId: "s1",
      selected: { kind: "chat", windowId: "w_talk_abc" },
    });
  });
  it("parseRoute reads issue selection", () => {
    const r = parseRoute("/flows/s1", "?selected=issue:42", { sessionId: "s1" });
    expect(r).toEqual({
      kind: "session",
      sessionId: "s1",
      selected: { kind: "issue", issueId: 42 },
    });
  });
  it("parseRoute drops malformed selected silently", () => {
    const r = parseRoute("/flows/s1", "?selected=garbage", { sessionId: "s1" });
    expect(r).toEqual({ kind: "session", sessionId: "s1" });
  });
  it("parseRoute drops issue:<non-number> silently", () => {
    const r = parseRoute("/flows/s1", "?selected=issue:abc", { sessionId: "s1" });
    expect(r).toEqual({ kind: "session", sessionId: "s1" });
  });
});

describe("toPath ↔ parseRoute roundtrip", () => {
  for (const route of [
    { kind: "session", sessionId: "s1" },
    { kind: "session", sessionId: "s1", objectId: "user", threadId: "root" },
    { kind: "file", path: "stones/main/agent_of_x/self.md" },
    {
      kind: "file",
      path: "flows/s1/objects/x/files/foo.md",
      thread: { sessionId: "s1", objectId: "x", threadId: "t1" },
    },
    { kind: "scope", scope: "flows" },
    { kind: "issueDetail", sessionId: "s1", issueId: 4 },
  ] as const) {
    it(`roundtrip ${JSON.stringify(route)}`, () => {
      const url = toPath(route as never);
      const [pathname, search] = url.split("?");
      // 模拟 react-router 的 useParams 行为：抽出 sessionId / objectId / id 等
      const params: Record<string, string> = {};
      const fp = pathname!.replace(/\/+$/, "");
      const flowM = /^\/flows\/([^/]+)/.exec(fp);
      if (flowM) params.sessionId = flowM[1]!;
      const issueM = /^\/flows\/([^/]+)\/issues\/(.+)$/.exec(fp);
      if (issueM) {
        params.sessionId = issueM[1]!;
        params.id = issueM[2]!;
      }
      const r = parseRoute(pathname!, search ? "?" + search : "", params);
      expect(r).toEqual(route as never);
    });
  }
});
