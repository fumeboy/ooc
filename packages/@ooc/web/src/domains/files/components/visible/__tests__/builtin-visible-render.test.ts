/**
 * P1 (2026-06-29) — 8 个新 builtin window detail 组件的渲染烟雾测试。
 *
 * 思路: 给每个组件喂一个最小合法 window object,renderToStaticMarkup 出 HTML 串,
 *   - 不抛异常 → 烟雾通过
 *   - 含关键字段(如 path / query / content / status 等)→ 真渲染了,不是空壳
 *
 * 不验证: 视觉细节 / className 完整性 / 交互(本 phase 无交互, read-only)
 * 不依赖: happy-dom / jsdom — renderToStaticMarkup 是纯字符串渲染
 */
import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import type { ContextWindow } from "../../../context-snapshot";

import FileWindowDetail from "../FileWindowDetail";
import KnowledgeWindowDetail from "../KnowledgeWindowDetail";
import TodoWindowDetail from "../TodoWindowDetail";
import SearchWindowDetail from "../SearchWindowDetail";
import SkillIndexWindowDetail from "../SkillIndexWindowDetail";
import PlanWindowDetail from "../PlanWindowDetail";
import ProgramWindowDetail from "../ProgramWindowDetail";
import RootWindowDetail from "../RootWindowDetail";

function render(Comp: any, window: any): string {
  return renderToStaticMarkup(React.createElement(Comp, { window }) as any);
}

test("FileWindowDetail renders path + viewport", () => {
  const w: any = {
    id: "f1",
    class: "file",
    title: "file: foo.ts",
    status: "open",
    path: "src/foo.ts",
    lines: [0, 100],
    columns: [0, 80],
    createdAt: Date.now(),
  };
  const html = render(FileWindowDetail, w);
  expect(html).toContain("src/foo.ts");
  expect(html.length).toBeGreaterThan(50);
});

test("KnowledgeWindowDetail renders path + source + body", () => {
  const w: any = {
    id: "k1",
    class: "knowledge",
    title: "knowledge",
    status: "open",
    path: "build-tools/file-ops",
    source: "activator",
    presentation: "summary",
    description: "如何用 file-edit-primitive 改源文件",
    body: "# hello\nworld",
    createdAt: Date.now(),
  };
  const html = render(KnowledgeWindowDetail, w);
  expect(html).toContain("build-tools/file-ops");
  expect(html.toLowerCase()).toContain("activator");
});

test("TodoWindowDetail renders content + status", () => {
  const w: any = {
    id: "t1",
    class: "todo",
    title: "todo",
    status: "open",
    content: "实装 builtin visible",
    createdAt: Date.now(),
  };
  const html = render(TodoWindowDetail, w);
  expect(html).toContain("实装 builtin visible");
});

test("SearchWindowDetail renders kind + query + matches", () => {
  const w: any = {
    id: "s1",
    class: "search",
    title: "search",
    status: "open",
    kind: "grep",
    query: "BUILTIN_VISIBLE",
    matches: [
      { index: 0, path: "a.ts", line: 10, snippet: "const BUILTIN_VISIBLE = ..." },
      { index: 1, path: "b.ts", line: 20, snippet: "BUILTIN_VISIBLE[t]" },
    ],
    truncated: false,
    searchRoot: "packages/",
  };
  const html = render(SearchWindowDetail, w);
  expect(html).toContain("BUILTIN_VISIBLE");
  expect(html).toContain("a.ts");
});

test("SearchWindowDetail empty matches renders empty state", () => {
  const w: any = {
    id: "s2",
    class: "search",
    title: "search",
    status: "open",
    kind: "glob",
    query: "*.never",
    matches: [],
    truncated: false,
  };
  const html = render(SearchWindowDetail, w);
  expect(html.length).toBeGreaterThan(30);
});

test("SkillIndexWindowDetail renders skills", () => {
  const w: any = {
    id: "si1",
    class: "skill_index",
    title: "skills",
    status: "active",
    skills: [
      { name: "open_file", description: "open a file", skillFilePath: "_builtin/filesystem/file", scope: "branch" },
      { name: "grep", description: "regex search", skillFilePath: "_builtin/filesystem/search", scope: "branch" },
    ],
  };
  const html = render(SkillIndexWindowDetail, w);
  expect(html).toContain("open_file");
  expect(html).toContain("grep");
});

test("PlanWindowDetail renders steps", () => {
  const w: any = {
    id: "p1",
    class: "plan",
    title: "plan",
    status: "active",
    description: "ship P1",
    steps: [
      { id: "s1", text: "实装组件", status: "done" },
      { id: "s2", text: "切注册表", status: "in-progress" },
      { id: "s3", text: "跑 build", status: "pending" },
    ],
    createdAt: Date.now(),
  };
  const html = render(PlanWindowDetail, w);
  expect(html).toContain("实装组件");
  expect(html).toContain("切注册表");
  expect(html).toContain("跑 build");
});

test("ProgramWindowDetail renders history", () => {
  const w: any = {
    id: "pr1",
    class: "program",
    title: "program",
    status: "open",
    history: [
      {
        execId: "e1",
        language: "ts",
        code: "console.log('hi')",
        output: "hi",
        ok: true,
        startedAt: Date.now(),
      },
    ],
  };
  const html = render(ProgramWindowDetail, w);
  expect(html).toContain("hi");
});

test("ProgramWindowDetail empty history renders empty state", () => {
  const w: any = {
    id: "pr2",
    class: "program",
    title: "program",
    status: "open",
    history: [],
  };
  const html = render(ProgramWindowDetail, w);
  expect(html.length).toBeGreaterThan(30);
});

test("RootWindowDetail renders title", () => {
  const w: any = {
    id: "root",
    class: "root",
    title: "Thread root",
    status: "open",
    createdAt: Date.now(),
  };
  const html = render(RootWindowDetail, w);
  expect(html).toContain("Thread root");
});
