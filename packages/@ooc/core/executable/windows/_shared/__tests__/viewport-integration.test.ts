/**
 * viewport 协议 — file_window / knowledge_window 端到端集成测试。
 *
 * 覆盖：
 * - open_file 自动填默认 viewport 0-200/0-200
 * - file_window.set_viewport 合并 + fail-loud
 * - file_window render 按 viewport 切行+切列
 * - open_knowledge 自动填默认 viewport
 * - knowledge_window.set_viewport 同 file 行为
 */
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { execRootMethod, WindowManager, builtinRegistry } from "../../index";
import type { FileWindow, KnowledgeWindow } from "../types";
import { createStoneObject, createPoolObject, poolKnowledgeDir } from "../../../../persistable";
import { buildContext } from "../../../../thinkable/context";
import { clearKnowledgeLoaderCache } from "../../../../thinkable/knowledge";
import { makeThread } from "../../../../__tests__/make-thread";

describe("viewport: file_window integration", () => {
  it("open_file 默认填 viewport 0-200/0-200", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-"));
    try {
      const file = join(tempRoot, "x.txt");
      await writeFile(file, "hello\n");
      const thread = makeThread({ id: "t" });
      await execRootMethod("open_file", { thread, args: { path: file, title: "x" } });
      const fw = thread.contextWindows.find((w): w is FileWindow => w.class === "file");
      expect(fw).toBeDefined();
      expect(fw!.state!.viewport).toEqual({
        lineStart: 0,
        lineEnd: 200,
        columnStart: 0,
        columnEnd: 200,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("默认 0-200 对小文件等价全文（向后兼容现有 e2e）", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-"));
    try {
      const file = join(tempRoot, "small.txt");
      await writeFile(file, "alpha\nbeta\ngamma\n");
      const thread = makeThread({ id: "t" });
      await execRootMethod("open_file", { thread, args: { path: file, title: "s" } });
      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain("alpha");
      expect(xml).toContain("beta");
      expect(xml).toContain("gamma");
      expect(xml).not.toContain("more lines");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("超长文件按 viewport 切行 + overflow marker", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-"));
    try {
      const file = join(tempRoot, "big.txt");
      const content = Array.from({ length: 300 }, (_, i) => `LINE_${i}`).join("\n");
      await writeFile(file, content);
      const thread = makeThread({ id: "t" });
      await execRootMethod("open_file", { thread, args: { path: file, title: "b" } });
      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain("LINE_0");
      expect(xml).toContain("LINE_199");
      expect(xml).not.toContain("LINE_200");
      expect(xml).toContain("…(+100 more lines)");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("set_viewport 合并字段；未传字段保留旧值", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-"));
    try {
      const file = join(tempRoot, "f.txt");
      await writeFile(file, "x\n".repeat(500));
      const thread = makeThread({ id: "t" });
      await execRootMethod("open_file", { thread, args: { path: file, title: "f" } });
      const fw = thread.contextWindows.find((w): w is FileWindow => w.class === "file")!;

      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: fw.id,
        method: "set_viewport",
        title: "extend",
        args: { line_end: 1000 },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);

      const after = thread.contextWindows.find((w): w is FileWindow => w.class === "file")!;
      expect(after.state!.viewport).toEqual({
        lineStart: 0,
        lineEnd: 1000,
        columnStart: 0,
        columnEnd: 200,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("set_viewport fail-loud: line_start > line_end", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-"));
    try {
      const file = join(tempRoot, "f.txt");
      await writeFile(file, "a\n");
      const thread = makeThread({ id: "t" });
      await execRootMethod("open_file", { thread, args: { path: file, title: "f" } });
      const fw = thread.contextWindows.find((w): w is FileWindow => w.class === "file")!;
      const origViewport = { ...fw.state!.viewport! };

      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      await mgr.openMethodExec({
        thread,
        parentWindowId: fw.id,
        method: "set_viewport",
        title: "bad",
        args: { line_start: 100, line_end: 50 },
      });
      thread.contextWindows = mgr.toData();

      // failed form 持有报错；window viewport 未变
      const after = thread.contextWindows.find((w): w is FileWindow => w.class === "file")!;
      expect(after.state!.viewport).toEqual(origViewport);
      const failedForm = thread.contextWindows.find(
        (w) => w.class === "method_exec" && (w as { method?: string }).method === "set_viewport",
      ) as { status: string; result?: string } | undefined;
      expect(failedForm?.status).toBe("failed");
      expect(failedForm?.result ?? "").toContain("line_start");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("render 按 column 截断超长行", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-"));
    try {
      const file = join(tempRoot, "wide.txt");
      await writeFile(file, "x".repeat(500) + "\n");
      const thread = makeThread({ id: "t" });
      await execRootMethod("open_file", { thread, args: { path: file, title: "w" } });
      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain("…(+300 more)");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("viewport: knowledge_window integration", () => {
  it("open_knowledge 默认填 viewport 0-200/0-200; set_viewport 合并", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ooc-vp-kw-"));
    clearKnowledgeLoaderCache();
    try {
      await createStoneObject({ baseDir: tempRoot, objectId: "agent" });
      const poolRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
      const knDir = poolKnowledgeDir(poolRef);
      // 长 knowledge 文档，超 200 行
      const longBody = Array.from({ length: 300 }, (_, i) => `KN_${i}`).join("\n");
      await writeFile(join(knDir, "longdoc.md"), `---\ndescription: 长文档\n---\n${longBody}`);

      const thread = makeThread({
        id: "t",
        persistence: { baseDir: tempRoot, sessionId: "s", objectId: "agent", threadId: "t" },
      });
      await execRootMethod("open_knowledge", { thread, args: { path: "longdoc", title: "long" } });

      const kw = thread.contextWindows.find(
        (w): w is KnowledgeWindow => w.class === "knowledge" && (w as KnowledgeWindow).source === "explicit",
      );
      expect(kw).toBeDefined();
      expect(kw!.state!.viewport).toEqual({
        lineStart: 0,
        lineEnd: 200,
        columnStart: 0,
        columnEnd: 200,
      });

      // render 应截行
      const messages = await buildContext(thread);
      const xml = messages[0]?.content ?? "";
      expect(xml).toContain("KN_0");
      expect(xml).toContain("KN_199");
      // KN_200..KN_299 不应出现在 explicit knowledge_window 的 viewport 切片中
      // (但 activator 仍可能 force-full;检查 explicit window content 切片是否生效:
      //  应至少出现一个 overflow marker)
      expect(xml).toContain("…(+100 more lines)");

      // 扩 viewport
      const mgr = WindowManager.fromThread(thread, builtinRegistry);
      const opened = await mgr.openMethodExec({
        thread,
        parentWindowId: kw!.id,
        method: "set_viewport",
        title: "expand",
        args: { line_end: 500 },
      });
      thread.contextWindows = mgr.toData();
      expect(opened.autoSubmitted).toBe(true);
      const after = thread.contextWindows.find(
        (w): w is KnowledgeWindow => w.class === "knowledge" && (w as KnowledgeWindow).source === "explicit",
      )!;
      expect(after.state!.viewport).toEqual({
        lineStart: 0,
        lineEnd: 500,
        columnStart: 0,
        columnEnd: 200,
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
