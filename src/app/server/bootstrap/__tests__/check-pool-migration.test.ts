/**
 * check-pool-migration 单测 (2026-05-25 Round 6 Batch C, AgentOfPersistable)
 *
 * 覆盖点:
 * 1. 纯 seed knowledge (stones/<id>/knowledge/<*.md> 无子目录) → **不触发**警告
 * 2. stone 下 knowledge/memory/ 或 knowledge/relations/ 子目录 → 触发 sedimentInStoneKnowledge
 * 3. stone 下 files/ 子目录 → 触发 sedimentInStoneFiles
 * 4. 同时具备 seed .md + sediment 子目录 → 只按 sediment 信号触发（seed 合法）
 * 5. fs error / 空 world → 平稳返回空结果（advisory 不应炸）
 *
 * 这些是 2026-05-24 seed/sediment 二分后的核心 invariant —— 旧逻辑会把任何
 * stone/knowledge/ 都标为 legacy，对 supervisor 5 篇合法 seed 永久报警。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { checkStoneToPoolMigration } from "../check-pool-migration";

let tempRoot: string | undefined;

beforeEach(() => {
  tempRoot = undefined;
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

async function newWorld(): Promise<string> {
  tempRoot = await mkdtemp(join(tmpdir(), "ooc-poolcheck-"));
  return tempRoot;
}

async function makeStoneWithKnowledge(baseDir: string, objectId: string, files: Record<string, string>): Promise<void> {
  const kdir = join(baseDir, "stones", "main", "objects", objectId, "knowledge");
  await mkdir(kdir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(kdir, name), body, "utf8");
  }
}

async function makeStoneSedimentDir(baseDir: string, objectId: string, sub: "memory" | "relations"): Promise<void> {
  const p = join(baseDir, "stones", "main", "objects", objectId, "knowledge", sub);
  await mkdir(p, { recursive: true });
  await writeFile(join(p, "x.md"), "---\ntitle: x\n---\n", "utf8");
}

async function makeStoneFilesDir(baseDir: string, objectId: string): Promise<void> {
  const p = join(baseDir, "stones", "main", "objects", objectId, "files");
  await mkdir(p, { recursive: true });
}

describe("checkStoneToPoolMigration (post 2026-05-24 seed/sediment split)", () => {
  test("pure seed knowledge (flat .md) does NOT trigger warning", async () => {
    const baseDir = await newWorld();
    await makeStoneWithKnowledge(baseDir, "supervisor", {
      "creating-objects.md": "---\ntitle: x\n---\n",
      "eight-dimensions.md": "---\ntitle: y\n---\n",
    });
    const r = await checkStoneToPoolMigration({ baseDir });
    expect(r.sedimentInStoneKnowledge).toEqual([]);
    expect(r.sedimentInStoneFiles).toEqual([]);
  });

  test("stone-side knowledge/memory/ triggers sedimentInStoneKnowledge", async () => {
    const baseDir = await newWorld();
    await makeStoneSedimentDir(baseDir, "alpha", "memory");
    const r = await checkStoneToPoolMigration({ baseDir });
    expect(r.sedimentInStoneKnowledge).toEqual(["alpha"]);
    expect(r.sedimentInStoneFiles).toEqual([]);
  });

  test("stone-side knowledge/relations/ triggers sedimentInStoneKnowledge", async () => {
    const baseDir = await newWorld();
    await makeStoneSedimentDir(baseDir, "beta", "relations");
    const r = await checkStoneToPoolMigration({ baseDir });
    expect(r.sedimentInStoneKnowledge).toEqual(["beta"]);
  });

  test("stone-side files/ triggers sedimentInStoneFiles", async () => {
    const baseDir = await newWorld();
    await makeStoneFilesDir(baseDir, "gamma");
    const r = await checkStoneToPoolMigration({ baseDir });
    expect(r.sedimentInStoneFiles).toEqual(["gamma"]);
    expect(r.sedimentInStoneKnowledge).toEqual([]);
  });

  test("mixed seed + sediment: only sediment shape triggers warning (seed legitimate)", async () => {
    const baseDir = await newWorld();
    await makeStoneWithKnowledge(baseDir, "delta", { "intro.md": "---\ntitle: x\n---\n" });
    await makeStoneSedimentDir(baseDir, "delta", "memory");
    const r = await checkStoneToPoolMigration({ baseDir });
    expect(r.sedimentInStoneKnowledge).toEqual(["delta"]);
  });

  test("empty world: returns empty arrays (no throw)", async () => {
    const baseDir = await newWorld();
    const r = await checkStoneToPoolMigration({ baseDir });
    expect(r).toEqual({ sedimentInStoneKnowledge: [], sedimentInStoneFiles: [] });
  });
});
