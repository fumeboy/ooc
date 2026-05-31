/**
 * OtherRenderers.test — Round 10 F3.
 *
 * 覆盖剩余 renderer 的最小烟雾 / 4 态：DoWindowDiff / SearchWindowDiff /
 * KnowledgeWindowDiff / ProgramWindowDiff / CommandExecDiff。
 * （RelationWindowDiff 已随 OOC-4 L6a relation_window 删除而移除。）
 *
 * 每个 renderer 至少 1 个 changed + 1 个 added/removed 用例（验证 type-dispatch 后
 * UI 不崩 + 视觉编码 data-diff-status 落字段）。
 */

import { describe, expect, it } from "bun:test";
import { DoWindowDiff } from "./DoWindowDiff";
import { SearchWindowDiff } from "./SearchWindowDiff";
import { KnowledgeWindowDiff } from "./KnowledgeWindowDiff";
import { ProgramWindowDiff } from "./ProgramWindowDiff";
import { CommandExecDiff } from "./CommandExecDiff";
import { countByStatus } from "./test-utils";

describe("DoWindowDiff", () => {
  it("Case 1: status 变化 (running → archived) → changed", () => {
    const tree = DoWindowDiff({
      previous: { type: "do", status: "running", targetThreadId: "t1" },
      current: { type: "do", status: "archived", targetThreadId: "t1" },
      windowType: "do",
      windowId: "w_do_1",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: previous undefined → added", () => {
    const tree = DoWindowDiff({
      previous: undefined,
      current: { type: "do", status: "running" },
      windowType: "do",
      windowId: "w_do_2",
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: 不变 → unchanged", () => {
    const tree = DoWindowDiff({
      previous: { type: "do", status: "running", targetThreadId: "t1" },
      current: { type: "do", status: "running", targetThreadId: "t1" },
      windowType: "do",
      windowId: "w_do_3",
    });
    expect(countByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });
});

describe("SearchWindowDiff", () => {
  it("Case 1: 新增 match → added", () => {
    const tree = SearchWindowDiff({
      previous: { type: "search", matches: [{ path: "a", line: 1 }] },
      current: {
        type: "search",
        matches: [
          { path: "a", line: 1 },
          { path: "b", line: 2 },
        ],
      },
      windowType: "search",
      windowId: "w_s_1",
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 删除 match → removed", () => {
    const tree = SearchWindowDiff({
      previous: {
        type: "search",
        matches: [
          { path: "a", line: 1 },
          { path: "b", line: 2 },
        ],
      },
      current: { type: "search", matches: [{ path: "a", line: 1 }] },
      windowType: "search",
      windowId: "w_s_2",
    });
    expect(countByStatus(tree, "removed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: snippet 变 → changed", () => {
    const tree = SearchWindowDiff({
      previous: { type: "search", matches: [{ path: "a", line: 1, snippet: "old" }] },
      current: { type: "search", matches: [{ path: "a", line: 1, snippet: "new" }] },
      windowType: "search",
      windowId: "w_s_3",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });
});

describe("KnowledgeWindowDiff", () => {
  it("Case 1: body 变 + frontmatter 字段 diff → 含 changed 字段", () => {
    const tree = KnowledgeWindowDiff({
      previous: {
        type: "knowledge",
        path: "k.md",
        body: "old body",
        frontmatter: { title: "A" },
      },
      current: {
        type: "knowledge",
        path: "k.md",
        body: "new body",
        frontmatter: { title: "B" },
      },
      windowType: "knowledge",
      windowId: "w_k_1",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: added (previous undefined) → 不崩", () => {
    const tree = KnowledgeWindowDiff({
      previous: undefined,
      current: { type: "knowledge", path: "k.md", body: "x" },
      windowType: "knowledge",
      windowId: "w_k_2",
    });
    expect(tree).toBeDefined();
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });
});

describe("ProgramWindowDiff", () => {
  it("Case 1: 新增 exec → added", () => {
    const tree = ProgramWindowDiff({
      previous: { type: "program", history: [{ execId: "e1", code: "ls", output: "ok", ok: true }] },
      current: {
        type: "program",
        history: [
          { execId: "e1", code: "ls", output: "ok", ok: true },
          { execId: "e2", code: "pwd", output: "/x", ok: true },
        ],
      },
      windowType: "program",
      windowId: "w_p_1",
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: 不变 → unchanged", () => {
    const h = [{ execId: "e1", code: "ls", output: "ok", ok: true }];
    const tree = ProgramWindowDiff({
      previous: { type: "program", history: h },
      current: { type: "program", history: h },
      windowType: "program",
      windowId: "w_p_2",
    });
    expect(countByStatus(tree, "unchanged")).toBeGreaterThanOrEqual(1);
  });
});

describe("CommandExecDiff", () => {
  it("Case 1: args 新增 key → added", () => {
    const tree = CommandExecDiff({
      previous: { type: "command_exec", method: "search", accumulatedArgs: { q: "x" } },
      current: { type: "command_exec", method: "search", accumulatedArgs: { q: "x", limit: 10 } },
      windowType: "command_exec",
      windowId: "w_ce_1",
    });
    expect(countByStatus(tree, "added")).toBeGreaterThanOrEqual(1);
  });

  it("Case 2: args 改值 → changed", () => {
    const tree = CommandExecDiff({
      previous: { type: "command_exec", method: "search", accumulatedArgs: { q: "x" } },
      current: { type: "command_exec", method: "search", accumulatedArgs: { q: "y" } },
      windowType: "command_exec",
      windowId: "w_ce_2",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });

  it("Case 3: status 变 → changed (Round 13 四态机: open → failed)", () => {
    const tree = CommandExecDiff({
      previous: { type: "command_exec", method: "search", status: "open" },
      current: { type: "command_exec", method: "search", status: "failed" },
      windowType: "command_exec",
      windowId: "w_ce_3",
    });
    expect(countByStatus(tree, "changed")).toBeGreaterThanOrEqual(1);
  });
});

