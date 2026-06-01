import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendRow,
  createPoolObject,
  poolDataDir,
  poolDataFile,
  readCsv,
  writeCsv,
  __resetSerialQueueForTests,
  type PoolObjectRef,
} from "../index";

let tempRoot: string | undefined;
let ref: PoolObjectRef;

beforeEach(async () => {
  __resetSerialQueueForTests();
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-csv-pool-"));
  ref = await createPoolObject({ baseDir: tempRoot, objectId: "alice" });
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("csv-pool: poolDataFile name validation", () => {
  test("合法 kebab-case 名通过", () => {
    expect(poolDataFile(ref, "events")).toBe(join(poolDataDir(ref), "events.csv"));
    expect(poolDataFile(ref, "factor-group-1")).toBe(join(poolDataDir(ref), "factor-group-1.csv"));
  });

  test("非法名拒绝（防 path-traversal / 强制 kebab）", () => {
    expect(() => poolDataFile(ref, "Bad Name")).toThrow(/Invalid csv name/);
    expect(() => poolDataFile(ref, "../escape")).toThrow(/Invalid csv name/);
    expect(() => poolDataFile(ref, "UPPER")).toThrow(/Invalid csv name/);
    expect(() => poolDataFile(ref, "1starts-with-digit")).toThrow(/Invalid csv name/);
    expect(() => poolDataFile(ref, "")).toThrow(/Invalid csv name/);
    // > 64 char
    expect(() => poolDataFile(ref, "a".repeat(65))).toThrow(/Invalid csv name/);
  });
});

describe("csv-pool: createPoolObject 预创 data/ 目录", () => {
  test("data/ 在 createPoolObject 后立刻可见", async () => {
    const s = await stat(poolDataDir(ref));
    expect(s.isDirectory()).toBe(true);
  });
});

describe("csv-pool: readCsv", () => {
  test("文件不存在 → 返回空数组", async () => {
    expect(await readCsv(ref, "missing")).toEqual([]);
  });

  test("空文件 → 返回空数组", async () => {
    await writeFile(poolDataFile(ref, "empty"), "", "utf8");
    expect(await readCsv(ref, "empty")).toEqual([]);
  });

  test("仅 header 无数据 → 返回空数组", async () => {
    await writeFile(poolDataFile(ref, "headeronly"), "a,b,c\n", "utf8");
    expect(await readCsv(ref, "headeronly")).toEqual([]);
  });
});

describe("csv-pool: write → read 往返", () => {
  test("写一组 rows 再读回得到等价对象", async () => {
    const rows = [
      { name: "alice", age: "30", note: "ok" },
      { name: "bob", age: "25", note: "ok" },
    ];
    await writeCsv(ref, "people", rows);
    const back = await readCsv<(typeof rows)[number]>(ref, "people");
    expect(back).toEqual(rows);
  });

  test("rows 空 → 空文件，再读回 []", async () => {
    await writeCsv(ref, "people", []);
    const text = await readFile(poolDataFile(ref, "people"), "utf8");
    expect(text).toBe("");
    expect(await readCsv(ref, "people")).toEqual([]);
  });

  test("第二次 writeCsv 覆盖前一次", async () => {
    await writeCsv(ref, "people", [{ name: "alice" }]);
    await writeCsv(ref, "people", [{ name: "bob" }]);
    expect(await readCsv(ref, "people")).toEqual([{ name: "bob" }]);
  });
});

describe("csv-pool: appendRow", () => {
  test("append 到不存在的文件 → 自动创建 header + 一行", async () => {
    await appendRow(ref, "log", { ts: "1", event: "boot" });
    const back = await readCsv(ref, "log");
    expect(back).toEqual([{ ts: "1", event: "boot" }]);
  });

  test("多次 append 累积", async () => {
    await appendRow(ref, "log", { ts: "1", event: "boot" });
    await appendRow(ref, "log", { ts: "2", event: "tick" });
    await appendRow(ref, "log", { ts: "3", event: "stop" });
    const back = await readCsv(ref, "log");
    expect(back).toEqual([
      { ts: "1", event: "boot" },
      { ts: "2", event: "tick" },
      { ts: "3", event: "stop" },
    ]);
  });

  test("append 到已有文件保留原 header 顺序", async () => {
    await writeCsv(ref, "log", [{ ts: "1", event: "boot" }]);
    await appendRow(ref, "log", { event: "tick", ts: "2" }); // 故意乱序传入
    const text = await readFile(poolDataFile(ref, "log"), "utf8");
    // header 应保持 ts,event
    expect(text.split("\n")[0]).toBe("ts,event");
    expect(await readCsv(ref, "log")).toEqual([
      { ts: "1", event: "boot" },
      { ts: "2", event: "tick" },
    ]);
  });
});

describe("csv-pool: 串行化避免并发撕裂", () => {
  test("并发 writeCsv 两次 → 最终是某一次的完整内容，不混合", async () => {
    const A = [
      { id: "1", v: "a1" },
      { id: "2", v: "a2" },
    ];
    const B = [
      { id: "1", v: "b1" },
      { id: "2", v: "b2" },
      { id: "3", v: "b3" },
    ];
    await Promise.all([writeCsv(ref, "race", A), writeCsv(ref, "race", B)]);
    const back = await readCsv(ref, "race");
    // 必须等于 A 或 B 之一，不能是混合
    const isA = JSON.stringify(back) === JSON.stringify(A);
    const isB = JSON.stringify(back) === JSON.stringify(B);
    expect(isA || isB).toBe(true);
  });

  test("并发 appendRow 多次 → 所有行都在，无截断/重复", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ i: String(i), v: `val-${i}` }));
    await Promise.all(rows.map((r) => appendRow(ref, "log", r)));
    const back = await readCsv(ref, "log");
    expect(back.length).toBe(10);
    // 内容集合应等同（顺序不保证，因为并发入队顺序非确定）
    const sorted = [...back].sort((a, b) => Number(a.i) - Number(b.i));
    expect(sorted).toEqual(rows);
  });
});

describe("csv-pool: 特殊字符 RFC 4180 转义", () => {
  test("值含逗号 → 用引号包裹后读回相同", async () => {
    const rows = [{ k: "x", v: "hello, world" }];
    await writeCsv(ref, "special", rows);
    expect(await readCsv(ref, "special")).toEqual(rows);
  });

  test("值含双引号 → 转义为 \"\" 后读回相同", async () => {
    const rows = [{ k: "x", v: 'he said "hi"' }];
    await writeCsv(ref, "special", rows);
    expect(await readCsv(ref, "special")).toEqual(rows);
  });

  test("值含换行 → 用引号包裹后读回相同（保留 \\n）", async () => {
    const rows = [{ k: "x", v: "line1\nline2" }];
    await writeCsv(ref, "special", rows);
    expect(await readCsv(ref, "special")).toEqual(rows);
  });

  test("混合：逗号 + 引号 + 换行", async () => {
    const rows = [
      { k: "k1", v: 'a,b,"c"\nd' },
      { k: "k2", v: "plain" },
    ];
    await writeCsv(ref, "special", rows);
    expect(await readCsv(ref, "special")).toEqual(rows);
  });
});

describe("csv-pool: 原子写", () => {
  test("写后无 .tmp 残留", async () => {
    await writeCsv(ref, "atomic", [{ a: "1" }]);
    const tmp = `${poolDataFile(ref, "atomic")}.tmp`;
    let exists = true;
    try {
      await stat(tmp);
    } catch (e) {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
