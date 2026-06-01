import { describe, expect, it } from "bun:test";
import { parseRoute, toPath } from "./routing";

/**
 * 2026-05-27 路由模型重构：
 *   path 决定视图 (`/flows/index` / `/flows/thread_context`)，sessionId 从 path 移到 query。
 *   tests 整体改造为 flowsView；老 `/flows/:sessionId` 形态仅保留 parse-only 兼容用例。
 */

describe("toPath: /flows/<view> + ?sessionId=&objectId=&threadId=", () => {
  it("flowsView index without query → bare path", () => {
    expect(toPath({ kind: "flowsView", view: "index" })).toBe("/flows/index");
  });
  it("flowsView index with sessionId only", () => {
    expect(toPath({ kind: "flowsView", view: "index", sessionId: "s1" })).toBe(
      "/flows/index?sessionId=s1",
    );
  });
  it("flowsView index with full thread context", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "index",
        sessionId: "s1",
        objectId: "supervisor",
        threadId: "t1",
      }),
    ).toBe("/flows/index?sessionId=s1&objectId=supervisor&threadId=t1");
  });
  it("flowsView thread_context with full thread context", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "thread_context",
        sessionId: "s1",
        objectId: "supervisor",
        threadId: "t1",
      }),
    ).toBe("/flows/thread_context?sessionId=s1&objectId=supervisor&threadId=t1");
  });
  it("file without thread", () => {
    expect(toPath({ kind: "file", path: "stones/main/agent_of_x/self.md" })).toBe(
      "/files/stones/main/agent_of_x/self.md",
    );
  });
  it("file path == stone client entry → shortcut /stones/<objectId> (post bare-repo reorg)", () => {
    // 2026-05-21 stones repo 重组：client 入口路径是 stones/<branch>/objects/<id>/client/index.tsx
    expect(
      toPath({ kind: "file", path: "stones/main/objects/alpha/client/index.tsx" }),
    ).toBe("/stones/alpha");
  });
  it("file path == legacy flat stone client → falls back to /files/* (no shortcut)", () => {
    // 旧 flat layout (stones/<id>/client/index.tsx) 不再被 normalize 当 shortcut；
    // 直接当普通文件渲染，保住老链接不炸。
    expect(
      toPath({ kind: "file", path: "stones/alpha/client/index.tsx" }),
    ).toBe("/files/stones/alpha/client/index.tsx");
  });
  it("file with thread context attaches sessionId/objectId/threadId", () => {
    expect(
      toPath({
        kind: "file",
        path: "flows/s1/agent_of_x/files/foo.md",
        thread: { sessionId: "s1", objectId: "agent_of_x", threadId: "t1" },
      }),
    ).toBe(
      "/files/flows/s1/agent_of_x/files/foo.md?sessionId=s1&objectId=agent_of_x&threadId=t1",
    );
  });
  it("encodes special characters in query values", () => {
    const got = toPath({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      objectId: "obj/with slash",
      threadId: "t&id",
    });
    expect(got).toBe(
      "/flows/index?sessionId=s1&objectId=obj%2Fwith%20slash&threadId=t%26id",
    );
  });
});

describe("parseRoute: new path forms", () => {
  it("/flows/index → flowsView{view:index} bare", () => {
    const r = parseRoute("/flows/index", "");
    expect(r).toEqual({ kind: "flowsView", view: "index" });
  });
  it("/flows/index?sessionId= → flowsView{view:index} with sessionId only", () => {
    const r = parseRoute("/flows/index", "?sessionId=s1");
    expect(r).toEqual({ kind: "flowsView", view: "index", sessionId: "s1" });
  });
  it("/flows/index?sessionId=&objectId=&threadId= → flowsView{view:index} with full thread", () => {
    const r = parseRoute(
      "/flows/index",
      "?sessionId=s1&objectId=supervisor&threadId=t1",
    );
    expect(r).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      objectId: "supervisor",
      threadId: "t1",
    });
  });
  it("/flows/thread_context?sessionId=&objectId=&threadId= → flowsView{view:thread_context}", () => {
    const r = parseRoute(
      "/flows/thread_context",
      "?sessionId=s1&objectId=supervisor&threadId=t1",
    );
    expect(r).toEqual({
      kind: "flowsView",
      view: "thread_context",
      sessionId: "s1",
      objectId: "supervisor",
      threadId: "t1",
    });
  });
  it("/files/<path>?sessionId=&objectId=&threadId= → file with thread", () => {
    const r = parseRoute(
      "/files/flows/s1/x/files/foo.md",
      "?sessionId=s1&objectId=x&threadId=t1",
    );
    expect(r).toEqual({
      kind: "file",
      path: "flows/s1/x/files/foo.md",
      thread: { sessionId: "s1", objectId: "x", threadId: "t1" },
    });
  });
  it("/files/<path> without query → bare file route", () => {
    const r = parseRoute("/files/stones/main/agent_of_x/self.md", "");
    expect(r).toEqual({ kind: "file", path: "stones/main/agent_of_x/self.md" });
  });
});

/**
 * Legacy 兼容（仅解析，不产出）：旧形态 `/flows/<sid>` 与 `/flows/<sid>/threads/<oid>/<tid>`
 * 必须仍可解析，不能让老书签炸。
 */
describe("parseRoute: legacy /flows/:sessionId compatibility (parse-only)", () => {
  it("legacy /flows/s1 → flowsView{view:index} (no peer)", () => {
    const r = parseRoute("/flows/s1", "", { sessionId: "s1" });
    expect(r).toEqual({ kind: "flowsView", view: "index", sessionId: "s1" });
  });
  it("legacy /flows/s1?objectId=user&threadId=root → flowsView{view:index} with thread", () => {
    const r = parseRoute("/flows/s1", "?objectId=user&threadId=root", {
      sessionId: "s1",
    });
    expect(r).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      objectId: "user",
      threadId: "root",
    });
  });
  it("legacy /flows/s1?objectId=supervisor&threadId=t1 (peer) → flowsView{view:thread_context}", () => {
    const r = parseRoute("/flows/s1", "?objectId=supervisor&threadId=t1", {
      sessionId: "s1",
    });
    expect(r).toEqual({
      kind: "flowsView",
      view: "thread_context",
      sessionId: "s1",
      objectId: "supervisor",
      threadId: "t1",
    });
  });
  it("legacy /flows/s1/threads/oid/tid → flowsView{view:thread_context}", () => {
    const r = parseRoute("/flows/s1/threads/agent_of_x/t1", "", {
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "t1",
    });
    expect(r).toEqual({
      kind: "flowsView",
      view: "thread_context",
      sessionId: "s1",
      objectId: "agent_of_x",
      threadId: "t1",
    });
  });
});

/**
 * ?selected= 兼容：现新代码不再产出 selected（SessionThreadsIndex 改用 objectId+threadId
 * 切右栏），但旧链接里带的 selected query 仍要可解析、可 toPath round-trip 输出回去。
 */
describe("flowsView ?selected= round-trip (legacy compat)", () => {
  it("toPath embeds chat selection", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "index",
        sessionId: "s1",
        selected: { kind: "chat", windowId: "w_talk_abc" },
      }),
    ).toBe("/flows/index?sessionId=s1&selected=chat%3Aw_talk_abc");
  });
  it("toPath embeds thread selection", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "index",
        sessionId: "s1",
        selected: { kind: "thread", objectId: "supervisor", threadId: "t_abc" },
      }),
    ).toBe("/flows/index?sessionId=s1&selected=thread%3Asupervisor%3At_abc");
  });
  it("parseRoute reads chat selection", () => {
    const r = parseRoute("/flows/index", "?sessionId=s1&selected=chat:w_talk_abc");
    expect(r).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      selected: { kind: "chat", windowId: "w_talk_abc" },
    });
  });
  it("parseRoute reads thread selection", () => {
    const r = parseRoute(
      "/flows/index",
      "?sessionId=s1&selected=thread:supervisor:t_abc",
    );
    expect(r).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      selected: { kind: "thread", objectId: "supervisor", threadId: "t_abc" },
    });
  });
  it("parseRoute drops malformed selected silently", () => {
    const r = parseRoute("/flows/index", "?sessionId=s1&selected=garbage");
    expect(r).toEqual({ kind: "flowsView", view: "index", sessionId: "s1" });
  });
  it("parseRoute drops unknown tag silently (Round 7 A3: issue 已移除)", () => {
    const r = parseRoute("/flows/index", "?sessionId=s1&selected=issue:42");
    expect(r).toEqual({ kind: "flowsView", view: "index", sessionId: "s1" });
  });
  it("parseRoute drops malformed thread selection (no threadId)", () => {
    const r = parseRoute("/flows/index", "?sessionId=s1&selected=thread:supervisor");
    expect(r).toEqual({ kind: "flowsView", view: "index", sessionId: "s1" });
  });
  it("parseRoute drops malformed thread selection (empty objectId)", () => {
    const r = parseRoute("/flows/index", "?sessionId=s1&selected=thread::t_abc");
    expect(r).toEqual({ kind: "flowsView", view: "index", sessionId: "s1" });
  });
});

/**
 * Round 9 E3 (2026-05-26): `?loop=N` 表示 Loop Time Machine 当前查看的 loopIndex。
 * 仅在 flowsView 上有意义；非法值（负数 / NaN / 非整数）静默丢；不传 = Latest。
 */
describe("flowsView ?loop= — Loop Time Machine 状态", () => {
  it("toPath 写出 loop=N", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "thread_context",
        sessionId: "s1",
        objectId: "supervisor",
        threadId: "t1",
        loop: 23,
      }),
    ).toBe(
      "/flows/thread_context?sessionId=s1&objectId=supervisor&threadId=t1&loop=23",
    );
  });
  it("toPath 不写 loop 字段（undefined）", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "thread_context",
        sessionId: "s1",
      }),
    ).toBe("/flows/thread_context?sessionId=s1");
  });
  it("toPath loop=0 也写出（loop 0 是合法值）", () => {
    expect(
      toPath({
        kind: "flowsView",
        view: "index",
        sessionId: "s1",
        loop: 0,
      }),
    ).toBe("/flows/index?sessionId=s1&loop=0");
  });
  it("parseRoute 读出 loop=N", () => {
    const r = parseRoute(
      "/flows/thread_context",
      "?sessionId=s1&objectId=supervisor&threadId=t1&loop=23",
    );
    expect(r).toEqual({
      kind: "flowsView",
      view: "thread_context",
      sessionId: "s1",
      objectId: "supervisor",
      threadId: "t1",
      loop: 23,
    });
  });
  it("parseRoute 非法 loop（负数 / NaN / 浮点）静默丢", () => {
    expect(parseRoute("/flows/index", "?sessionId=s1&loop=-1")).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
    });
    expect(parseRoute("/flows/index", "?sessionId=s1&loop=abc")).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
    });
    expect(parseRoute("/flows/index", "?sessionId=s1&loop=1.5")).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
    });
  });
  it("parseRoute loop=0 合法", () => {
    expect(parseRoute("/flows/index", "?sessionId=s1&loop=0")).toEqual({
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      loop: 0,
    });
  });
  it("loop round-trip", () => {
    const route = {
      kind: "flowsView" as const,
      view: "thread_context" as const,
      sessionId: "s1",
      objectId: "x",
      threadId: "t1",
      loop: 7,
    };
    const url = toPath(route);
    const [pathname, search] = url.split("?");
    const r = parseRoute(pathname!, search ? "?" + search : "");
    expect(r).toEqual(route);
  });
});

describe("toPath ↔ parseRoute roundtrip", () => {
  for (const route of [
    { kind: "flowsView", view: "index" },
    { kind: "flowsView", view: "index", sessionId: "s1" },
    {
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      objectId: "user",
      threadId: "root",
    },
    {
      kind: "flowsView",
      view: "thread_context",
      sessionId: "s1",
      objectId: "supervisor",
      threadId: "t1",
    },
    {
      kind: "flowsView",
      view: "index",
      sessionId: "s1",
      selected: { kind: "thread", objectId: "supervisor", threadId: "t_abc" },
    },
    { kind: "file", path: "stones/main/agent_of_x/self.md" },
    {
      kind: "file",
      path: "flows/s1/x/files/foo.md",
      thread: { sessionId: "s1", objectId: "x", threadId: "t1" },
    },
    { kind: "scope", scope: "flows" },
  ] as const) {
    it(`roundtrip ${JSON.stringify(route)}`, () => {
      const url = toPath(route as never);
      const [pathname, search] = url.split("?");
      const r = parseRoute(pathname!, search ? "?" + search : "");
      expect(r).toEqual(route as never);
    });
  }
});
