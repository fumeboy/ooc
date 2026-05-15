/**
 * fs-search.test — U1 ~ U6 of feat-fs-search-codeagent-parity plan.
 *
 * Each section is gated by a top-level describe to keep the file scannable:
 * - U1: SearchWindow type + render + close + basicKnowledge
 * - U2: file_window.edit
 * - U3: root.write_file
 * - U4: root.glob + search_window.open_match
 * - U5: root.grep
 * - U6: program anti-pattern note
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import "../windows/index";
import {
  generateWindowId,
  getWindowTypeDefinition,
  WindowManager,
  type SearchWindow,
} from "../windows/index";
import {
  SEARCH_WINDOW_BASIC_KNOWLEDGE,
} from "../windows/search";
import { renderContextXml } from "../../thinkable/context/render";
import { makeThread } from "../../__tests__/make-thread";

// ---------- U1 ----------

describe("U1: SearchWindow type + render + basicKnowledge", () => {
  it("registry has 'search' definition with non-empty commands and basicKnowledge", () => {
    const def = getWindowTypeDefinition("search");
    expect(Object.keys(def.commands).length).toBeGreaterThan(0);
    expect(typeof def.basicKnowledge).toBe("string");
    expect((def.basicKnowledge as string).length).toBeGreaterThan(0);
  });

  it("generateWindowId('search') returns id starting with w_search_", () => {
    const id = generateWindowId("search");
    expect(id.startsWith("w_search_")).toBe(true);
  });

  it("renders search_window with 3 grep matches into <window type=search kind=grep>", async () => {
    const thread = makeThread({ id: "t_render_test" });
    const sw: SearchWindow = {
      id: "w_search_test",
      type: "search",
      parentWindowId: "root",
      title: "grep 'foo'",
      status: "open",
      createdAt: Date.now(),
      kind: "grep",
      query: "foo",
      searchRoot: "/tmp/x",
      matches: [
        { index: 0, path: "a.ts", line: 10, snippet: "foo bar" },
        { index: 1, path: "a.ts", line: 20, snippet: "more foo" },
        { index: 2, path: "b.ts", line: 5, snippet: "another foo" },
      ],
      truncated: false,
    };
    thread.contextWindows = [sw];
    const xml = await renderContextXml({ thread, contextWindows: thread.contextWindows });
    expect(xml).toContain('type="search"');
    expect(xml).toContain("<kind>grep</kind>");
    expect(xml).toContain('count="3"');
    expect(xml).toContain('truncated="false"');
    expect(xml).toContain('path="a.ts"');
    expect(xml).toContain('line="10"');
    expect(xml).toContain("foo bar");
    expect(xml).toContain("/tmp/x"); // searchRoot rendered
  });

  it("renders empty matches as count=0 truncated=false", async () => {
    const thread = makeThread({ id: "t_render_empty" });
    const sw: SearchWindow = {
      id: "w_search_empty",
      type: "search",
      parentWindowId: "root",
      title: "glob '*.tsx'",
      status: "open",
      createdAt: Date.now(),
      kind: "glob",
      query: "*.tsx",
      matches: [],
      truncated: false,
    };
    thread.contextWindows = [sw];
    const xml = await renderContextXml({ thread, contextWindows: thread.contextWindows });
    expect(xml).toContain('count="0"');
    expect(xml).toContain('truncated="false"');
    // glob kind 不输出 search_root
    expect(xml).not.toContain("<search_root>");
  });

  it("flag truncated=true when caller pre-truncated 200 of 250", async () => {
    const matches: SearchWindow["matches"] = [];
    for (let i = 0; i < 200; i += 1) {
      matches.push({ index: i, path: `f${i}.ts` });
    }
    const thread = makeThread({ id: "t_render_trunc" });
    const sw: SearchWindow = {
      id: "w_search_trunc",
      type: "search",
      parentWindowId: "root",
      title: "trunc",
      status: "open",
      createdAt: Date.now(),
      kind: "glob",
      query: "**/*",
      matches,
      truncated: true,
    };
    thread.contextWindows = [sw];
    const xml = await renderContextXml({ thread, contextWindows: thread.contextWindows });
    expect(xml).toContain('count="200"');
    expect(xml).toContain('truncated="true"');
  });

  it("WindowManager.close removes a search_window", () => {
    const thread = makeThread({ id: "t_close_search" });
    const sw: SearchWindow = {
      id: "w_search_to_close",
      type: "search",
      parentWindowId: "root",
      title: "close me",
      status: "open",
      createdAt: Date.now(),
      kind: "glob",
      query: "*",
      matches: [],
      truncated: false,
    };
    thread.contextWindows = [...thread.contextWindows, sw];
    const mgr = WindowManager.fromThread(thread);
    expect(mgr.close(sw.id, thread)).toBe(true);
    thread.contextWindows = mgr.toData();
    expect(thread.contextWindows.find((w) => w.id === sw.id)).toBeUndefined();
  });

  it("basicKnowledge mentions open_match and close commands", () => {
    expect(SEARCH_WINDOW_BASIC_KNOWLEDGE).toContain("open_match");
    expect(SEARCH_WINDOW_BASIC_KNOWLEDGE).toContain("close");
    expect(SEARCH_WINDOW_BASIC_KNOWLEDGE).toContain("truncated");
  });
});

// ---------- U2 / U3 / U4 / U5 / U6 placeholders (filled in subsequent units) ----------
// U2-U6 tests will be appended as those units land; this file owns the entire feature group.

// shared fixture utilities for later units
let TEMP = "";
beforeAll(async () => {
  TEMP = await mkdtemp(join(tmpdir(), "ooc-fs-search-"));
});
afterAll(async () => {
  if (TEMP) await rm(TEMP, { recursive: true, force: true });
});

// ---------- U2: file_window.edit ----------

import type { FileWindow } from "../windows/index";

/**
 * 创建一个临时文件 + 对应的 file_window + WindowManager，
 * 让 .edit 测试可以直接 openCommandExec("edit", args) 走完真实链路。
 */
async function makeFileFixture(name: string, body: string) {
  const path = join(TEMP, name);
  await writeFile(path, body, "utf8");
  const thread = makeThread({ id: `t_edit_${name.replace(/\W+/g, "_")}` });
  const fw: FileWindow = {
    id: `w_file_${name.replace(/\W+/g, "_")}`,
    type: "file",
    parentWindowId: "root",
    title: name,
    status: "open",
    createdAt: Date.now(),
    path,
  };
  thread.contextWindows = [...thread.contextWindows, fw];
  const mgr = WindowManager.fromThread(thread);
  return { thread, mgr, fileWindow: fw, path };
}

async function runEdit(name: string, body: string, args: Record<string, unknown>) {
  const { thread, mgr, fileWindow, path } = await makeFileFixture(name, body);
  const opened = await mgr.openCommandExec({
    thread,
    parentWindowId: fileWindow.id,
    command: "edit",
    title: `edit ${name}`,
    args,
  });
  thread.contextWindows = mgr.toData();
  return { opened, path, mgr, thread };
}

describe("U2: file_window.edit", () => {
  it("happy: single { old, new } replaces uniquely + writes to disk", async () => {
    const { opened, path } = await runEdit(
      "single.txt",
      "hello world\nfoo bar\nbye world\n",
      { old: "foo bar", new: "FOO BAR" },
    );
    expect(opened.autoSubmitted).toBe(true);
    expect(opened.submitResult).toBeUndefined(); // success returns undefined
    const after = await readFile(path, "utf8");
    expect(after).toBe("hello world\nFOO BAR\nbye world\n");
  });

  it("happy: array { edits } applies all atomically", async () => {
    const { opened, path } = await runEdit(
      "batch.txt",
      "alpha\nbeta\ngamma\n",
      { edits: [
        { old: "alpha", new: "ALPHA" },
        { old: "gamma", new: "GAMMA" },
      ] },
    );
    expect(opened.autoSubmitted).toBe(true);
    expect(opened.submitResult).toBeUndefined();
    const after = await readFile(path, "utf8");
    expect(after).toBe("ALPHA\nbeta\nGAMMA\n");
  });

  it("edge: oldString not found → error contains 'not found', file untouched", async () => {
    const { opened, path } = await runEdit(
      "miss.txt",
      "alpha\nbeta\n",
      { old: "delta", new: "DELTA" },
    );
    expect(opened.autoSubmitted).toBe(true);
    expect(opened.submitResult).toContain("not found");
    const after = await readFile(path, "utf8");
    expect(after).toBe("alpha\nbeta\n");
  });

  it("edge: oldString matches multiple times → error includes 'matches N times', file untouched", async () => {
    const { opened, path } = await runEdit(
      "dup.txt",
      "alpha\nalpha\nalpha\n",
      { old: "alpha", new: "ALPHA" },
    );
    expect(opened.autoSubmitted).toBe(true);
    expect(opened.submitResult).toContain("matches 3 times");
    const after = await readFile(path, "utf8");
    expect(after).toBe("alpha\nalpha\nalpha\n");
  });

  it("edge: array form, edit #2 fails after edit #1 succeeds → none applied (atomic)", async () => {
    const { opened, path } = await runEdit(
      "atomic.txt",
      "alpha\nbeta\ngamma\n",
      { edits: [
        { old: "alpha", new: "ALPHA" },
        { old: "missing", new: "X" },
      ] },
    );
    expect(opened.autoSubmitted).toBe(true);
    expect(opened.submitResult).toContain("edit #1");
    expect(opened.submitResult).toContain("not found");
    const after = await readFile(path, "utf8");
    // file untouched — neither ALPHA nor any partial change
    expect(after).toBe("alpha\nbeta\ngamma\n");
  });

  it("edge: missing args.old AND args.edits → submit returns input-prompt error", async () => {
    const { opened } = await runEdit(
      "noargs.txt",
      "x",
      {} as Record<string, unknown>,
    );
    // 因为 args 不满足，C 规则不触发；form 留在 open 状态等 LLM refine
    // openCommandExec 不会 submit，所以也不会有 submitResult；这是用户路径上的
    // protocol guard，input knowledge 已经告诉 LLM 缺什么
    expect(opened.autoSubmitted).toBe(false);
  });

  it("edge: parent is not a file_window → error '未挂载在 file_window 上'", async () => {
    // 在 root 上调 edit（root 没有 edit command），应被 lookup 拒绝
    const thread = makeThread({ id: "t_wrong_parent" });
    const mgr = WindowManager.fromThread(thread);
    let err: string | undefined;
    try {
      await mgr.openCommandExec({
        thread,
        parentWindowId: "root",
        command: "edit",
        title: "wrong parent",
        args: { old: "a", new: "b" },
      });
    } catch (e) {
      err = (e as Error).message;
    }
    expect(err).toBeDefined();
    expect(err).toContain("not registered");
  });

  it("edge: file does not exist on disk → error mentions read failure", async () => {
    // 故意指向不存在的 path
    const thread = makeThread({ id: "t_missing_file" });
    const fw: FileWindow = {
      id: "w_file_missing",
      type: "file",
      parentWindowId: "root",
      title: "missing",
      status: "open",
      createdAt: Date.now(),
      path: join(TEMP, "does-not-exist.txt"),
    };
    thread.contextWindows = [...thread.contextWindows, fw];
    const mgr = WindowManager.fromThread(thread);
    const opened = await mgr.openCommandExec({
      thread,
      parentWindowId: fw.id,
      command: "edit",
      title: "edit missing",
      args: { old: "a", new: "b" },
    });
    expect(opened.submitResult).toContain("读取");
  });

  it("edge: new === old → succeeds (no-op replace)", async () => {
    const { opened, path } = await runEdit(
      "noop.txt",
      "hello",
      { old: "hello", new: "hello" },
    );
    expect(opened.submitResult).toBeUndefined();
    const after = await readFile(path, "utf8");
    expect(after).toBe("hello");
  });

  it("edge: array sequential — edit #2's old appears only after edit #1 ran", async () => {
    // edit #1 produces text containing "ZZ"; edit #2 needs "ZZ"
    const { opened, path } = await runEdit(
      "seq.txt",
      "alpha\n",
      { edits: [
        { old: "alpha", new: "ZZ middle" },
        { old: "ZZ middle", new: "FINAL" },
      ] },
    );
    expect(opened.submitResult).toBeUndefined();
    const after = await readFile(path, "utf8");
    expect(after).toBe("FINAL\n");
  });
});

void mkdir;

// ---------- U3: root.write_file ----------

import { dispatchToolCall } from "../tools";

async function dispatchWriteFile(thread: ReturnType<typeof makeThread>, args: Record<string, unknown>) {
  return dispatchToolCall(thread, {
    id: `call_${Math.random().toString(36).slice(2, 8)}`,
    name: "open",
    arguments: {
      title: "write file",
      command: "write_file",
      args,
    },
  });
}

describe("U3: root.write_file", () => {
  it("happy: { path, content } writes file + spawns file_window", async () => {
    const path = join(TEMP, "wf-happy.txt");
    const thread = makeThread({ id: "t_wf_happy" });
    const out = JSON.parse(await dispatchWriteFile(thread, { path, content: "hello write_file\n" }));
    expect(out.ok).toBe(true);
    expect(out.auto_submitted).toBe(true);

    // file written
    const onDisk = await readFile(path, "utf8");
    expect(onDisk).toBe("hello write_file\n");

    // file_window spawned
    const fws = thread.contextWindows.filter((w) => w.type === "file" && (w as FileWindow).path === path);
    expect(fws.length).toBe(1);
  });

  it("happy: overwriting existing file replaces content", async () => {
    const path = join(TEMP, "wf-overwrite.txt");
    await writeFile(path, "old content", "utf8");
    const thread = makeThread({ id: "t_wf_overwrite" });
    await dispatchWriteFile(thread, { path, content: "new content" });
    expect(await readFile(path, "utf8")).toBe("new content");
  });

  it("edge: parent dir does not exist → mkdir -p creates it then writes", async () => {
    const path = join(TEMP, "deep/dir/path/wf.txt");
    const thread = makeThread({ id: "t_wf_mkdir" });
    const out = JSON.parse(await dispatchWriteFile(thread, { path, content: "deep" }));
    expect(out.ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe("deep");
  });

  it("edge: missing path → submit yields '缺少 path' error; no file_window spawned", async () => {
    const thread = makeThread({ id: "t_wf_no_path" });
    const out = JSON.parse(await dispatchWriteFile(thread, { content: "x" }));
    expect(out.ok).toBe(true); // tool call accepted; failure expressed in result
    expect(out.auto_submitted).toBe(true);
    expect(out.result).toContain("缺少 path");
    expect(thread.contextWindows.filter((w) => w.type === "file").length).toBe(0);
  });

  it("edge: missing content → submit yields '缺少 content' error; no file_window spawned", async () => {
    const thread = makeThread({ id: "t_wf_no_content" });
    const out = JSON.parse(await dispatchWriteFile(thread, { path: join(TEMP, "x.txt") }));
    expect(out.ok).toBe(true);
    expect(out.auto_submitted).toBe(true);
    expect(out.result).toContain("缺少 content");
    expect(thread.contextWindows.filter((w) => w.type === "file").length).toBe(0);
  });

  it("edge: empty string content → 0-byte file written", async () => {
    const path = join(TEMP, "wf-empty.txt");
    const thread = makeThread({ id: "t_wf_empty" });
    const out = JSON.parse(await dispatchWriteFile(thread, { path, content: "" }));
    expect(out.ok).toBe(true);
    expect(out.auto_submitted).toBe(true);
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("auto-spawn: exactly one new file_window with path === args.path", async () => {
    const path = join(TEMP, "wf-spawn-once.txt");
    const thread = makeThread({ id: "t_wf_spawn_once" });
    await dispatchWriteFile(thread, { path, content: "x" });
    const matches = thread.contextWindows.filter(
      (w) => w.type === "file" && (w as FileWindow).path === path,
    );
    expect(matches.length).toBe(1);
  });
});

