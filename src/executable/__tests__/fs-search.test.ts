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

void TEMP;
void writeFile;
void readFile;
void mkdir;
