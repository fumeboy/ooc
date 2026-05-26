/**
 * window-hash 单测 — Round 9 E2
 *
 * 不变量验证清单（design § 6 + cookbook E2-1 测试清单）：
 * 1. 同 window 两次 → 同 hash（确定性）
 * 2. _decayMeta 变化 → 同 hash（剥 volatile）
 * 3. 内容字段（如 file_window.content）变化 → 不同 hash
 * 4. 字段插入顺序变化 → 同 hash（sortedKeys 保护）
 * 5. compressLevel=0 vs undefined → 同 hash（默认值剥离）
 * 6. compressLevel=1 vs 0 → 不同 hash
 * 7. buildWindowsSnapshot 多 window → 数组顺序与输入一致
 */

import { describe, expect, it } from "bun:test";
import type { ContextWindow, FileWindow } from "@src/executable/windows/_shared/types";
import {
  buildWindowsSnapshot,
  computeWindowContentHash,
  stripVolatileWindow,
} from "../window-hash";

function makeFileWindow(overrides: Partial<FileWindow> = {}): FileWindow {
  return {
    id: "w_file_test",
    type: "file",
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

  it("_decayMeta change → same hash (volatile stripped)", () => {
    const base = makeFileWindow();
    const withDecay = {
      ...base,
      _decayMeta: { idleRounds: 3, sinceExecRounds: 5, level1Rounds: 0, lastSeenEventIdx: 12 },
    } as FileWindow;
    expect(computeWindowContentHash(base)).toBe(computeWindowContentHash(withDecay));
  });

  it("content field change → different hash", () => {
    // file_window 的 path 改了即视为内容变化
    const a = makeFileWindow({ path: "src/foo.ts" });
    const b = makeFileWindow({ path: "src/bar.ts" });
    expect(computeWindowContentHash(a)).not.toBe(computeWindowContentHash(b));
  });

  it("field insertion order change → same hash (sortedKeys)", () => {
    // 同字段、不同 key 插入顺序
    const a = { id: "w1", type: "file", title: "t", status: "open", createdAt: 1, path: "p" } as unknown as ContextWindow;
    const b = { path: "p", createdAt: 1, status: "open", title: "t", type: "file", id: "w1" } as unknown as ContextWindow;
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
    const w = makeFileWindow({ compressLevel: 0 }) as FileWindow & { _decayMeta?: unknown };
    w._decayMeta = { idleRounds: 1, sinceExecRounds: 0, level1Rounds: 0, lastSeenEventIdx: 0 };
    const before = JSON.stringify(w);
    stripVolatileWindow(w);
    expect(JSON.stringify(w)).toBe(before);
  });

  it("strips _decayMeta and compressLevel=0", () => {
    const w = makeFileWindow({ compressLevel: 0 }) as FileWindow & { _decayMeta?: unknown };
    w._decayMeta = { idleRounds: 1, sinceExecRounds: 0, level1Rounds: 0, lastSeenEventIdx: 0 };
    const out = stripVolatileWindow(w);
    expect("_decayMeta" in out).toBe(false);
    expect("compressLevel" in out).toBe(false);
  });

  it("preserves compressLevel=1 and 2", () => {
    const one = stripVolatileWindow(makeFileWindow({ compressLevel: 1 }));
    const two = stripVolatileWindow(makeFileWindow({ compressLevel: 2 }));
    expect(one.compressLevel).toBe(1);
    expect(two.compressLevel).toBe(2);
  });
});

describe("buildWindowsSnapshot", () => {
  it("preserves input order", () => {
    const a = makeFileWindow({ id: "w_a", path: "a.ts" });
    const b = makeFileWindow({ id: "w_b", path: "b.ts" });
    const c = makeFileWindow({ id: "w_c", path: "c.ts" });
    const snap = buildWindowsSnapshot([a, b, c]);
    expect(snap.map((e) => e.id)).toEqual(["w_a", "w_b", "w_c"]);
  });

  it("each entry has id/type/contentHash; optional fields conditional", () => {
    const w = makeFileWindow({ id: "w_x" });
    const snap = buildWindowsSnapshot([w]);
    expect(snap[0]!.id).toBe("w_x");
    expect(snap[0]!.type).toBe("file");
    expect(snap[0]!.contentHash).toBe(computeWindowContentHash(w));
    expect(snap[0]!.status).toBe("open");
    // compressLevel undefined → not present
    expect("compressLevel" in snap[0]!).toBe(false);
  });

  it("emits parentWindowId / compressLevel when present", () => {
    const w = makeFileWindow({ parentWindowId: "root", compressLevel: 2 });
    const snap = buildWindowsSnapshot([w]);
    expect(snap[0]!.parentWindowId).toBe("root");
    expect(snap[0]!.compressLevel).toBe(2);
  });

  it("hash differs between two windows with different content", () => {
    const a = makeFileWindow({ id: "w_a", path: "alpha.ts" });
    const b = makeFileWindow({ id: "w_b", path: "beta.ts" });
    const snap = buildWindowsSnapshot([a, b]);
    expect(snap[0]!.contentHash).not.toBe(snap[1]!.contentHash);
  });
});
