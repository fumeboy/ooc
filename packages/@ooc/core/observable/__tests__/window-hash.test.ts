/**
 * window-hash 单测
 *
 * 不变量验证清单（fileDiff）：
 * 1. 同 window 两次 → 同 hash（确定性）
 * 2. 内容字段（如 file_window.path）变化 → 不同 hash
 * 3. 字段插入顺序变化 → 同 hash（sortedKeys 保护）
 * 4. compressLevel=0 vs undefined → 同 hash（默认值剥离）
 * 5. compressLevel=1 vs 0 → 不同 hash
 * 6. buildWindowsSnapshot 多 window → 数组顺序与输入一致
 *
 * fileDiff 用例：
 * 8. non-file window → 不含 fileDiff
 * 9. file_window 首次出现 → previousContent=""  + currentContent=正文
 * 10. file_window 内容变化 → previousContent=旧 + currentContent=新（核心 case）
 * 11. file_window 二进制 → isBinary=true + both content=""
 * 12. file_window 太大 → tooLarge=true + both content=""
 * 13. file_window read 失败 → currentContent="" + console.warn
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type {
  ContextWindow,
  FileWindow,
  RootWindow,
} from "@ooc/core/_shared/types/context-window.js";
import {
  buildWindowsSnapshot,
  computeWindowContentHash,
  stripVolatileWindow,
  type WindowSnapshotEntry,
} from "../window-hash";

function makeFileWindow(overrides: Partial<FileWindow> = {}): FileWindow {
  return {
    id: "w_file_test",
    class: "file",
    title: "src/foo.ts",
    status: "open",
    createdAt: 1700000000000,
    path: "src/foo.ts",
    ...overrides,
  } as FileWindow;
}

describe("computeWindowContentHash — determinism & stability", () => {
  it("same window twice → same hash", () => {
    const w = makeFileWindow();
    expect(computeWindowContentHash(w)).toBe(computeWindowContentHash(w));
  });

  it("content field change → different hash", () => {
    // file_window 的 path 改了即视为内容变化
    const a = makeFileWindow({ path: "src/foo.ts" });
    const b = makeFileWindow({ path: "src/bar.ts" });
    expect(computeWindowContentHash(a)).not.toBe(computeWindowContentHash(b));
  });

  it("field insertion order change → same hash (sortedKeys)", () => {
    // 同字段、不同 key 插入顺序
    const a = { id: "w1", class: "file", title: "t", status: "open", createdAt: 1, path: "p" } as unknown as ContextWindow;
    const b = { path: "p", createdAt: 1, status: "open", title: "t", class: "file", id: "w1" } as unknown as ContextWindow;
    expect(computeWindowContentHash(a)).toBe(computeWindowContentHash(b));
  });

  it("compressLevel=0 vs undefined → same hash (default stripped)", () => {
    const undef = makeFileWindow();
    const zero = makeFileWindow({ compressLevel: 0 });
    expect(computeWindowContentHash(undef)).toBe(computeWindowContentHash(zero));
  });

  it("compressLevel=1 vs 0 → different hash", () => {
    const zero = makeFileWindow({ compressLevel: 0 });
    const one = makeFileWindow({ compressLevel: 1 });
    expect(computeWindowContentHash(zero)).not.toBe(computeWindowContentHash(one));
  });
});

describe("stripVolatileWindow — field policy", () => {
  it("does not mutate input window", () => {
    const w = makeFileWindow({ compressLevel: 0 });
    const before = JSON.stringify(w);
    stripVolatileWindow(w);
    expect(JSON.stringify(w)).toBe(before);
  });

  it("strips compressLevel=0", () => {
    const w = makeFileWindow({ compressLevel: 0 });
    const out = stripVolatileWindow(w);
    expect("compressLevel" in out).toBe(false);
  });

  it("preserves compressLevel=1 and 2", () => {
    const one = stripVolatileWindow(makeFileWindow({ compressLevel: 1 }));
    const two = stripVolatileWindow(makeFileWindow({ compressLevel: 2 }));
    expect(one.compressLevel).toBe(1);
    expect(two.compressLevel).toBe(2);
  });
});

describe("buildWindowsSnapshot — structure & ordering", () => {
  // 这些用例都不读 fs；用不存在 path 来制造可控失败 + 把 console.warn 静音。
  let originalWarn: typeof console.warn;
  beforeEach(() => {
    originalWarn = console.warn;
    console.warn = () => {};
  });
  afterEach(() => {
    console.warn = originalWarn;
  });

  it("preserves input order", async () => {
    const a = makeFileWindow({ id: "w_a", path: "/nonexistent/a.ts" });
    const b = makeFileWindow({ id: "w_b", path: "/nonexistent/b.ts" });
    const c = makeFileWindow({ id: "w_c", path: "/nonexistent/c.ts" });
    const snap = await buildWindowsSnapshot([a, b, c]);
    expect(snap.map((e) => e.id)).toEqual(["w_a", "w_b", "w_c"]);
  });

  it("each entry has id/type/contentHash; optional fields conditional", async () => {
    const w = makeFileWindow({ id: "w_x", path: "/nonexistent/x.ts" });
    const snap = await buildWindowsSnapshot([w]);
    expect(snap[0]!.id).toBe("w_x");
    expect(snap[0]!.class).toBe("file");
    expect(snap[0]!.contentHash).toBe(computeWindowContentHash(w));
    expect(snap[0]!.status).toBe("open");
    // compressLevel undefined → not present
    expect("compressLevel" in snap[0]!).toBe(false);
  });

  it("emits parentWindowId / compressLevel when present", async () => {
    const w = makeFileWindow({
      id: "w_pc",
      parentWindowId: "root",
      compressLevel: 2,
      path: "/nonexistent/pc.ts",
    });
    const snap = await buildWindowsSnapshot([w]);
    expect(snap[0]!.parentWindowId).toBe("root");
    expect(snap[0]!.compressLevel).toBe(2);
  });

  it("hash differs between two windows with different content", async () => {
    const a = makeFileWindow({ id: "w_a", path: "/nonexistent/alpha.ts" });
    const b = makeFileWindow({ id: "w_b", path: "/nonexistent/beta.ts" });
    const snap = await buildWindowsSnapshot([a, b]);
    expect(snap[0]!.contentHash).not.toBe(snap[1]!.contentHash);
  });
});

describe("buildWindowsSnapshot — fileDiff", () => {
  let tempDir: string;
  let originalWarn: typeof console.warn;
  let warnCalls: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ooc-filediff-"));
    warnCalls = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.warn = originalWarn;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("non-file window has no fileDiff", async () => {
    const root: RootWindow = {
      id: "root",
      class: "root",
      title: "root",
      status: "active",
      createdAt: 1,
    } as RootWindow;
    const snap = await buildWindowsSnapshot([root]);
    expect(snap[0]!.fileDiff).toBeUndefined();
  });

  it("file_window first occurrence → previousContent='' currentContent=正文", async () => {
    const filePath = join(tempDir, "first.ts");
    await writeFile(filePath, "export const x = 1;\n", "utf8");
    const w = makeFileWindow({ id: "w_first", path: filePath });
    const snap = await buildWindowsSnapshot([w]); // 不传 prev → 首次
    expect(snap[0]!.fileDiff).toBeDefined();
    expect(snap[0]!.fileDiff!.path).toBe(filePath);
    expect(snap[0]!.fileDiff!.previousContent).toBe("");
    expect(snap[0]!.fileDiff!.currentContent).toBe("export const x = 1;\n");
    expect(snap[0]!.fileDiff!.isBinary).toBeUndefined();
    expect(snap[0]!.fileDiff!.tooLarge).toBeUndefined();
  });

  it("file_window content change → previousContent=旧 currentContent=新", async () => {
    const filePath = join(tempDir, "evolving.ts");
    await writeFile(filePath, "v1 content\n", "utf8");
    const w = makeFileWindow({ id: "w_evo", path: filePath });

    // Loop 1: 首次
    const snap1 = await buildWindowsSnapshot([w]);
    expect(snap1[0]!.fileDiff!.previousContent).toBe("");
    expect(snap1[0]!.fileDiff!.currentContent).toBe("v1 content\n");

    // Loop 2: 文件改了，传 snap1 作为 prev
    await writeFile(filePath, "v2 content here\n", "utf8");
    const snap2 = await buildWindowsSnapshot([w], snap1);
    expect(snap2[0]!.fileDiff!.previousContent).toBe("v1 content\n");
    expect(snap2[0]!.fileDiff!.currentContent).toBe("v2 content here\n");
  });

  it("file_window binary (contains \\0) → isBinary=true, both content=''", async () => {
    const filePath = join(tempDir, "image.bin");
    // 含 NUL byte 的内容
    await writeFile(filePath, "header\0\x01\x02tail", "utf8");
    const w = makeFileWindow({ id: "w_bin", path: filePath });
    const prevSnap: WindowSnapshotEntry[] = [
      {
        id: "w_bin",
        class: "file",
        contentHash: "stale",
        fileDiff: {
          previousContent: "old text",
          currentContent: "old text",
          path: filePath,
        },
      },
    ];
    const snap = await buildWindowsSnapshot([w], prevSnap);
    expect(snap[0]!.fileDiff!.isBinary).toBe(true);
    expect(snap[0]!.fileDiff!.previousContent).toBe("");
    expect(snap[0]!.fileDiff!.currentContent).toBe("");
    expect(snap[0]!.fileDiff!.tooLarge).toBeUndefined();
  });

  it("file_window too large (>200KB) → tooLarge=true, both content=''", async () => {
    const filePath = join(tempDir, "huge.txt");
    // 250KB 的纯文本
    const big = "a".repeat(250 * 1024);
    await writeFile(filePath, big, "utf8");
    const w = makeFileWindow({ id: "w_huge", path: filePath });
    const prevSnap: WindowSnapshotEntry[] = [
      {
        id: "w_huge",
        class: "file",
        contentHash: "stale",
        fileDiff: {
          previousContent: "small old",
          currentContent: "small old",
          path: filePath,
        },
      },
    ];
    const snap = await buildWindowsSnapshot([w], prevSnap);
    expect(snap[0]!.fileDiff!.tooLarge).toBe(true);
    expect(snap[0]!.fileDiff!.previousContent).toBe("");
    expect(snap[0]!.fileDiff!.currentContent).toBe("");
    expect(snap[0]!.fileDiff!.isBinary).toBeUndefined();
  });

  it("file_window read failure → currentContent='' + console.warn (no throw)", async () => {
    const missingPath = join(tempDir, "does-not-exist.ts");
    const w = makeFileWindow({ id: "w_missing", path: missingPath });
    const snap = await buildWindowsSnapshot([w]);
    expect(snap[0]!.fileDiff).toBeDefined();
    expect(snap[0]!.fileDiff!.currentContent).toBe("");
    expect(snap[0]!.fileDiff!.previousContent).toBe("");
    expect(warnCalls.some((m) => m.includes("[fileDiff]") && m.includes(missingPath))).toBe(true);
  });
});
