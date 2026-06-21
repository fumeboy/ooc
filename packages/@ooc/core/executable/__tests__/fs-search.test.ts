/**
 * fs-search.test — filesystem search/file class 在 Wave 4 对象模型下的行为验证。
 *
 * search / file 是非单例 class：search.construct 跑 glob / grep → 返回 Data{kind/query/matches/…}；
 * file.construct open/write；object method edit / open_match 经 ctx.runtime 造子对象。readable 把
 * Data 投影成 window。旧 form 机制（openMethodExec / autoSubmitted / submitResult / onFormChange）、
 * ContextWindow union（SearchWindow / FileWindow）、`getObjectDefinition`、`renderContextXml`(union)、
 * `runMethod` / `executeSearchOpenMatch` 命名导出均已退役。
 *
 * 分单元（top-level describe 便于扫读）：
 * - U1: search readable 投影（kind / query / matches / searchRoot）+ generateWindowId + WindowManager.close
 * - U2: file.edit object method（唯一替换 / 批量原子 / 边界）
 * - U3: file.construct write_file（写盘 / mkdir -p / 覆盖 hint / 缺参 throw）
 * - U4: search.construct glob + open_match object method
 * - U5: search.construct grep + runJsFallback
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

import "@ooc/core/runtime/register-builtins.js";
import { WindowManager } from "@ooc/core/runtime/window-manager.js";
import { builtinRegistry } from "@ooc/core/runtime/object-registry.js";
import { generateWindowId } from "@ooc/core/_shared/types/context-window.js";
import { serializeXml, xmlElement, type XmlNode } from "@ooc/core/_shared/types/xml.js";
import type { OocObjectInstance } from "@ooc/core/runtime/ooc-class.js";

import { Class as SearchClass } from "@ooc/builtins/filesystem/search";
import searchReadable from "@ooc/builtins/filesystem/search/readable/index.js";
import type { Data as SearchData } from "@ooc/builtins/filesystem/search/types";
import { runJsFallback } from "@ooc/builtins/filesystem/search/executable/grep-impl";
import { Class as FileClass } from "@ooc/builtins/filesystem/file";
import { construct as fileConstruct } from "@ooc/builtins/filesystem/file/executable/construct.js";
import type { Data as FileData } from "@ooc/builtins/filesystem/file/types";
import { makeThread } from "../../__tests__/make-thread";

const fileEdit = FileClass.executable!.methods.find((m) => m.name === "edit")!;
const searchOpenMatch = SearchClass.executable!.methods.find((m) => m.name === "open_match")!;

/** 渲染 search readable 投影 → XML（外层包 <window>）。 */
function renderSearchXml(self: SearchData, win: { resultsViewport?: unknown } = {}): string {
  const node = searchReadable.readable({} as never, self, win as never) as {
    class: string;
    content: XmlNode[];
  };
  const wrapper = xmlElement("window", { class: node.class }, node.content);
  return serializeXml(wrapper);
}

/** 最小 ctx stub（construct / method 只用到 thread / args / self / runtime）。 */
function ctxOf(thread: unknown, runtime?: unknown, self?: unknown) {
  return { thread, runtime, args: {}, self, reportDataEdit: async () => {} } as never;
}

let TEMP = "";
beforeAll(async () => {
  TEMP = await mkdtemp(join(tmpdir(), "ooc-fs-search-"));
});
afterAll(async () => {
  if (TEMP) await rm(TEMP, { recursive: true, force: true });
});

// ---------- U1: search readable 投影 + close ----------

describe("U1: search readable projection + close", () => {
  it("registry has 'filesystem/search' class with a constructor and object methods", () => {
    // register-builtins 注册键名归一后为 filesystem/search（strip _builtin/ 前缀）。
    expect(builtinRegistry.has("filesystem/search")).toBe(true);
    expect(builtinRegistry.resolveConstructor("filesystem/search")).toBeDefined();
    expect(builtinRegistry.resolveObjectMethods("filesystem/search").map((m) => m.name)).toEqual(
      expect.arrayContaining(["open_match", "close"]),
    );
  });

  it("generateWindowId('search') returns id starting with w_search_", () => {
    expect(generateWindowId("search").startsWith("w_search_")).toBe(true);
  });

  it("renders grep matches into <window class=search> with kind/count/path/snippet", () => {
    const self: SearchData = {
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
    const xml = renderSearchXml(self);
    expect(xml).toContain('class="search"');
    expect(xml).toContain("<kind>grep</kind>");
    expect(xml).toContain('count="3"');
    expect(xml).toContain('truncated="false"');
    expect(xml).toContain('path="a.ts"');
    expect(xml).toContain('line="10"');
    expect(xml).toContain("foo bar");
    expect(xml).toContain("/tmp/x"); // searchRoot rendered
  });

  it("renders empty matches as count=0; glob kind omits search_root", () => {
    const self: SearchData = {
      kind: "glob",
      query: "*.tsx",
      matches: [],
      truncated: false,
    };
    const xml = renderSearchXml(self);
    expect(xml).toContain('count="0"');
    expect(xml).toContain('truncated="false"');
    expect(xml).not.toContain("<search_root>");
  });

  it("flags truncated=true", () => {
    const matches: SearchData["matches"] = [];
    for (let i = 0; i < 200; i += 1) matches.push({ index: i, path: `f${i}.ts` });
    const self: SearchData = { kind: "glob", query: "**/*", matches, truncated: true };
    const xml = renderSearchXml(self);
    expect(xml).toContain('count="200"');
    expect(xml).toContain('truncated="true"');
  });

  it("WindowManager.close removes a search instance", async () => {
    const thread = makeThread({ id: "t_close_search" });
    const sw: OocObjectInstance = {
      id: "w_search_to_close",
      class: "search",
      title: "close me",
      status: "open",
      createdAt: Date.now(),
      data: { kind: "glob", query: "*", matches: [], truncated: false } satisfies SearchData,
    };
    thread.contextWindows = [...thread.contextWindows, sw];
    const mgr = WindowManager.fromThread(thread, builtinRegistry);
    await mgr.close(sw.id);
    thread.contextWindows = mgr.toData();
    expect(thread.contextWindows.find((w) => w.id === sw.id)).toBeUndefined();
  });
});

// ---------- U2: file.edit object method ----------

async function runEdit(name: string, body: string, args: Record<string, unknown>) {
  const path = join(TEMP, name);
  await writeFile(path, body, "utf8");
  const thread = makeThread({ id: `t_edit_${name.replace(/\W+/g, "_")}` });
  const self: FileData = { path };
  const result = await fileEdit.exec(ctxOf(thread, undefined, self), self, args);
  return { result, path };
}

describe("U2: file.edit object method", () => {
  it("happy: single { old, new } replaces uniquely + writes to disk", async () => {
    const { result, path } = await runEdit("single.txt", "hello world\nfoo bar\nbye world\n", {
      old: "foo bar",
      new: "FOO BAR",
    });
    expect(result).toBeUndefined(); // success returns undefined
    expect(await readFile(path, "utf8")).toBe("hello world\nFOO BAR\nbye world\n");
  });

  it("happy: array { edits } applies all atomically", async () => {
    const { result, path } = await runEdit("batch.txt", "alpha\nbeta\ngamma\n", {
      edits: [
        { old: "alpha", new: "ALPHA" },
        { old: "gamma", new: "GAMMA" },
      ],
    });
    expect(result).toBeUndefined();
    expect(await readFile(path, "utf8")).toBe("ALPHA\nbeta\nGAMMA\n");
  });

  it("edge: oldString not found → error contains 'not found', file untouched", async () => {
    const { result, path } = await runEdit("miss.txt", "alpha\nbeta\n", { old: "delta", new: "DELTA" });
    expect(result as string).toContain("not found");
    expect(await readFile(path, "utf8")).toBe("alpha\nbeta\n");
  });

  it("edge: oldString matches multiple times → 'matches N times', file untouched", async () => {
    const { result, path } = await runEdit("dup.txt", "alpha\nalpha\nalpha\n", { old: "alpha", new: "ALPHA" });
    expect(result as string).toContain("matches 3 times");
    expect(await readFile(path, "utf8")).toBe("alpha\nalpha\nalpha\n");
  });

  it("edge: array form, edit #2 fails after edit #1 → none applied (atomic)", async () => {
    const { result, path } = await runEdit("atomic.txt", "alpha\nbeta\ngamma\n", {
      edits: [
        { old: "alpha", new: "ALPHA" },
        { old: "missing", new: "X" },
      ],
    });
    expect(result as string).toContain("edit #1");
    expect(result as string).toContain("not found");
    expect(await readFile(path, "utf8")).toBe("alpha\nbeta\ngamma\n");
  });

  it("edge: missing args.old AND args.edits → input-prompt string", async () => {
    const { result } = await runEdit("noargs.txt", "x", {});
    expect(result as string).toContain("缺少");
  });

  it("edge: file does not exist on disk → error mentions read failure", async () => {
    const thread = makeThread({ id: "t_missing_file" });
    const self: FileData = { path: join(TEMP, "does-not-exist.txt") };
    const result = await fileEdit.exec(ctxOf(thread, undefined, self), self, { old: "a", new: "b" });
    expect(result as string).toContain("读取");
  });

  it("edge: new === old → succeeds (no-op replace)", async () => {
    const { result, path } = await runEdit("noop.txt", "hello", { old: "hello", new: "hello" });
    expect(result).toBeUndefined();
    expect(await readFile(path, "utf8")).toBe("hello");
  });

  it("edge: array sequential — edit #2's old appears only after edit #1 ran", async () => {
    const { result, path } = await runEdit("seq.txt", "alpha\n", {
      edits: [
        { old: "alpha", new: "ZZ middle" },
        { old: "ZZ middle", new: "FINAL" },
      ],
    });
    expect(result).toBeUndefined();
    expect(await readFile(path, "utf8")).toBe("FINAL\n");
  });
});

// ---------- U3: file.construct write_file ----------

async function constructWrite(thread: unknown, args: Record<string, unknown>): Promise<FileData> {
  return (await fileConstruct.exec(ctxOf(thread), args)) as FileData;
}

describe("U3: file.construct write_file", () => {
  it("happy: { path, content } writes file; Data.path = target", async () => {
    const path = join(TEMP, "wf-happy.txt");
    const thread = makeThread({ id: "t_wf_happy" });
    const data = await constructWrite(thread, { path, content: "hello write_file\n" });
    expect(data.path).toBe(path);
    expect(await readFile(path, "utf8")).toBe("hello write_file\n");
  });

  it("happy: overwriting existing file replaces content", async () => {
    const path = join(TEMP, "wf-overwrite.txt");
    await writeFile(path, "old content", "utf8");
    const thread = makeThread({ id: "t_wf_overwrite" });
    await constructWrite(thread, { path, content: "new content" });
    expect(await readFile(path, "utf8")).toBe("new content");
  });

  it("overwriting existing file injects [write_file hint] event nudging toward edit", async () => {
    const path = join(TEMP, "wf-hint.txt");
    await writeFile(path, "old content", "utf8");
    const thread = makeThread({ id: "t_wf_hint" });
    await constructWrite(thread, { path, content: "new content" });
    const hintEvent = thread.events.find(
      (e) =>
        e.category === "context_change" &&
        e.kind === "inject" &&
        typeof (e as { text?: string }).text === "string" &&
        (e as { text: string }).text.includes("[write_file hint]") &&
        (e as { text: string }).text.includes("file_window.edit"),
    );
    expect(hintEvent).toBeDefined();
  });

  it("creating brand-new file does NOT inject overwrite hint", async () => {
    const path = join(TEMP, "wf-new-no-hint.txt");
    const thread = makeThread({ id: "t_wf_new_no_hint" });
    await constructWrite(thread, { path, content: "fresh" });
    const hintEvent = thread.events.find(
      (e) => e.kind === "inject" && typeof (e as { text?: string }).text === "string" && (e as { text: string }).text.includes("[write_file hint]"),
    );
    expect(hintEvent).toBeUndefined();
  });

  it("edge: parent dir does not exist → mkdir -p creates it then writes", async () => {
    const path = join(TEMP, "deep/dir/path/wf.txt");
    const thread = makeThread({ id: "t_wf_mkdir" });
    await constructWrite(thread, { path, content: "deep" });
    expect(await readFile(path, "utf8")).toBe("deep");
  });

  it("edge: missing content → open_file branch (no write); missing file throws", async () => {
    // 无 content → construct 走 open_file 分支；不存在的 path → throw（不建窗）。
    const thread = makeThread({ id: "t_wf_no_content" });
    await expect(constructWrite(thread, { path: join(TEMP, "never.txt") })).rejects.toThrow(/不存在/);
  });

  it("edge: empty string content → 0-byte file written", async () => {
    const path = join(TEMP, "wf-empty.txt");
    const thread = makeThread({ id: "t_wf_empty" });
    await constructWrite(thread, { path, content: "" });
    expect(await readFile(path, "utf8")).toBe("");
  });
});

// ---------- U4: search.construct glob + open_match ----------

async function makeGlobFixtureDir(prefix: string, files: string[]) {
  const dir = join(TEMP, prefix);
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    const fullPath = join(dir, f);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, `// ${f}\n`, "utf8");
  }
  return dir;
}

/** search.construct 纯 glob 入参（pattern + cwd；不带 path/glob/case_insensitive 才走 glob 分支）。 */
async function runGlob(thread: unknown, pattern: string, cwd: string): Promise<SearchData> {
  return (await SearchClass.construct!.exec(ctxOf(thread), { pattern, cwd })) as SearchData;
}

describe("U4: search.construct glob + open_match", () => {
  it("happy: glob '*.ts' returns sorted matches", async () => {
    const dir = await makeGlobFixtureDir("glob-happy", ["a.ts", "b.ts", "c.ts", "ignore.md"]);
    const thread = makeThread({ id: "t_glob_happy" });
    const data = await runGlob(thread, "*.ts", dir);
    expect(data.kind).toBe("glob");
    expect(data.matches.map((m) => m.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(data.truncated).toBe(false);
  });

  it("happy: '**/*.ts' is recursive", async () => {
    const dir = await makeGlobFixtureDir("glob-recursive", ["top.ts", "sub/inner.ts", "deep/deeper/x.ts"]);
    const thread = makeThread({ id: "t_glob_recursive" });
    const data = await runGlob(thread, "**/*.ts", dir);
    expect(data.matches.map((m) => m.path).sort()).toEqual(["deep/deeper/x.ts", "sub/inner.ts", "top.ts"]);
  });

  it("edge: no matches → empty matches, truncated false", async () => {
    const dir = await makeGlobFixtureDir("glob-empty", ["a.md"]);
    const thread = makeThread({ id: "t_glob_empty" });
    const data = await runGlob(thread, "*.ts", dir);
    expect(data.matches).toEqual([]);
    expect(data.truncated).toBe(false);
  });

  it("edge: 250 matches → truncated to 200, flag=true", async () => {
    const files: string[] = [];
    for (let i = 0; i < 250; i += 1) files.push(`f${String(i).padStart(3, "0")}.ts`);
    const dir = await makeGlobFixtureDir("glob-truncate", files);
    const thread = makeThread({ id: "t_glob_truncate" });
    const data = await runGlob(thread, "*.ts", dir);
    expect(data.matches.length).toBe(200);
    expect(data.truncated).toBe(true);
  });

  it("edge: missing pattern → throws", async () => {
    const thread = makeThread({ id: "t_glob_no_pattern" });
    await expect(SearchClass.construct!.exec(ctxOf(thread), { cwd: TEMP })).rejects.toThrow(/缺少 pattern/);
  });

  it("open_match happy: instantiates a file object at the match's absolute path", async () => {
    const dir = await makeGlobFixtureDir("glob-open-match", ["one.ts", "two.ts", "three.ts"]);
    const thread = makeThread({ id: "t_open_match_happy" });
    const data = await runGlob(thread, "*.ts", dir);
    // sorted: one.ts(0), three.ts(1), two.ts(2)
    expect(data.matches[1]!.path).toBe("three.ts");

    const instantiated: Array<{ classId: string; args: Record<string, unknown> }> = [];
    const runtime = {
      instantiate: async (classId: string, args: Record<string, unknown>) => {
        instantiated.push({ classId, args });
        return "w_file_stub";
      },
    };
    const out = await searchOpenMatch.exec(ctxOf(thread, runtime, data), data, { index: 1 });
    expect(out).toBeUndefined();
    expect(instantiated).toHaveLength(1);
    // open_match 用注册 class id "_builtin/filesystem/file" 实例化（裸 "file" resolve 不到 constructor）。
    expect(instantiated[0]!.classId).toBe("_builtin/filesystem/file");
    expect(String(instantiated[0]!.args.path)).toMatch(/three\.ts$/);
    expect(String(instantiated[0]!.args.path).startsWith("/")).toBe(true);
  });

  it("open_match edge: index out of range → error string", async () => {
    const dir = await makeGlobFixtureDir("glob-oor", ["only.ts"]);
    const thread = makeThread({ id: "t_open_match_oor" });
    const data = await runGlob(thread, "*.ts", dir);
    const out = await searchOpenMatch.exec(ctxOf(thread, { instantiate: async () => "x" }, data), data, { index: 99 });
    expect(out as string).toContain("不存在");
  });

  it("open_match edge: missing index → input-prompt error string", async () => {
    const dir = await makeGlobFixtureDir("glob-no-idx", ["a.ts"]);
    const thread = makeThread({ id: "t_open_match_no_idx" });
    const data = await runGlob(thread, "*.ts", dir);
    const out = await searchOpenMatch.exec(ctxOf(thread, undefined, data), data, {});
    expect(out as string).toContain("缺少 index");
  });
});

// ---------- U5: search.construct grep + runJsFallback ----------

async function makeGrepFixtureDir(prefix: string, files: Record<string, string>) {
  const dir = join(TEMP, prefix);
  await mkdir(dir, { recursive: true });
  for (const [relPath, body] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body, "utf8");
  }
  return dir;
}

/** search.construct grep 入参（带 path → grep 分支）。 */
async function runGrep(thread: unknown, args: Record<string, unknown>): Promise<SearchData> {
  return (await SearchClass.construct!.exec(ctxOf(thread), args)) as SearchData;
}

describe("U5: search.construct grep + runJsFallback", () => {
  it("happy: simple pattern in one file → 1 match with line+snippet", async () => {
    const dir = await makeGrepFixtureDir("grep-simple", { "a.ts": "function foo() {}\nfunction bar() {}\n" });
    const thread = makeThread({ id: "t_grep_simple" });
    const data = await runGrep(thread, { pattern: "function foo", path: dir });
    expect(data.kind).toBe("grep");
    expect(data.matches.length).toBe(1);
    expect(data.matches[0]!.line).toBe(0);
    expect(data.matches[0]!.snippet).toContain("function foo");
  });

  it("happy: matches across multiple files sorted by (path, line)", async () => {
    const dir = await makeGrepFixtureDir("grep-multi", {
      "z.ts": "needle\n",
      "a.ts": "filler\nneedle\nfiller\nneedle\n",
    });
    const thread = makeThread({ id: "t_grep_multi" });
    const data = await runGrep(thread, { pattern: "needle", path: dir });
    expect(data.matches.length).toBe(3);
    expect(data.matches[0]!.line).toBe(1);
    expect(data.matches[2]!.path.endsWith("z.ts")).toBe(true);
  });

  it("happy: case_insensitive matches Foo and foo", async () => {
    const dir = await makeGrepFixtureDir("grep-ci", { "a.ts": "Foo bar\nfoo baz\nFOO qux\n" });
    const thread = makeThread({ id: "t_grep_ci" });
    const data = await runGrep(thread, { pattern: "foo", path: dir, case_insensitive: true });
    expect(data.matches.length).toBe(3);
  });

  it("edge: no matches → empty matches array", async () => {
    const dir = await makeGrepFixtureDir("grep-empty", { "a.ts": "nothing here\n" });
    const thread = makeThread({ id: "t_grep_empty" });
    const data = await runGrep(thread, { pattern: "needle", path: dir });
    expect(data.matches).toEqual([]);
    expect(data.truncated).toBe(false);
  });

  it("edge: path is a single file → still works", async () => {
    const dir = await makeGrepFixtureDir("grep-onefile", { "only.ts": "needle here\nand here too needle\n" });
    const thread = makeThread({ id: "t_grep_onefile" });
    const data = await runGrep(thread, { pattern: "needle", path: join(dir, "only.ts") });
    expect(data.matches.length).toBe(2);
  });

  it("integration: grep match line carries ± context lines into the file object", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 80; i += 1) lines.push(i === 40 ? "TARGET_TOKEN" : `line ${i}`);
    const dir = await makeGrepFixtureDir("grep-integ-open", { "big.ts": lines.join("\n") + "\n" });
    const thread = makeThread({ id: "t_grep_integ_open" });
    const data = await runGrep(thread, { pattern: "TARGET_TOKEN", path: dir });
    expect(data.matches.length).toBe(1);
    expect(data.matches[0]!.line).toBe(40);

    const instantiated: Array<{ classId: string; args: Record<string, unknown> }> = [];
    const runtime = {
      instantiate: async (classId: string, args: Record<string, unknown>) => {
        instantiated.push({ classId, args });
        return "w_file_stub";
      },
    };
    await searchOpenMatch.exec(ctxOf(thread, runtime, data), data, { index: 0 });
    const lineRange = instantiated[0]!.args.lines as [number, number];
    expect(lineRange[0]).toBeLessThanOrEqual(40);
    expect(lineRange[1]).toBeGreaterThanOrEqual(40);
  });

  it("fallback: runJsFallback produces equivalent shape on a small corpus", async () => {
    const dir = await makeGrepFixtureDir("grep-fallback", {
      "a.ts": "foo line one\nbar\nfoo line three\n",
      "b.txt": "no match here\nfoo on b.txt\n",
    });
    const hits = await runJsFallback({ pattern: "foo", path: dir, caseInsensitive: false });
    expect(hits.length).toBe(3);
    for (const h of hits) {
      expect(typeof h.path).toBe("string");
      expect(typeof h.line).toBe("number");
      expect(h.snippet.length).toBeGreaterThan(0);
    }
  });
});
