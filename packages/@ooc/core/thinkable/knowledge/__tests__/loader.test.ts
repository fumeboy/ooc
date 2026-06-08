import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createPoolObject,
  createStoneObject,
  poolKnowledgeDir,
  stoneDir,
  stoneKnowledgeDir,
  type PoolObjectRef,
  type StoneObjectRef,
} from "../../../persistable";
import { clearKnowledgeLoaderCache, loadKnowledgeIndex } from "../loader";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearKnowledgeLoaderCache();
});

/** 测试辅助：建立 stone + pool 一对 ref，同 objectId。 */
async function setupRefs(): Promise<{ stone: StoneObjectRef; pool: PoolObjectRef; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "ooc-kn-"));
  tempRoot = root;
  const stoneRef: StoneObjectRef = { baseDir: root, objectId: "agent" };
  await createStoneObject(stoneRef);
  const poolRef: PoolObjectRef = await createPoolObject({ baseDir: root, objectId: "agent" });
  return { stone: stoneRef, pool: poolRef, root };
}

describe("loadKnowledgeIndex (dual-source)", () => {
  test("empty knowledge directories return empty index", async () => {
    const { stone, pool } = await setupRefs();
    const index = await loadKnowledgeIndex({ stone, pool });
    expect(index.byPath.size).toBe(0);
  });

  test("missing both knowledge directories returns empty index", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    // 故意不 createStoneObject / createPoolObject，两侧 knowledge dir 都不存在
    const index = await loadKnowledgeIndex({
      stone: { baseDir: tempRoot, objectId: "ghost" },
      pool: { baseDir: tempRoot, objectId: "ghost" },
    });
    expect(index.byPath.size).toBe(0);
  });

  test("scans pool sediment files including nested subdirectories", async () => {
    const { stone, pool } = await setupRefs();
    const poolRoot = poolKnowledgeDir(pool);
    await writeFile(
      join(poolRoot, "a.md"),
      `---
description: A doc
activates_on:
  "method::root::program": "show_content"
---

body A`,
    );
    await mkdir(join(poolRoot, "sub"), { recursive: true });
    await writeFile(
      join(poolRoot, "sub", "b.md"),
      `---
description: B doc
---

body B`,
    );

    const index = await loadKnowledgeIndex({ stone, pool });
    expect(index.byPath.size).toBe(2);
    expect(index.byPath.has("a")).toBe(true);
    expect(index.byPath.has("sub/b")).toBe(true);
    expect(index.byPath.get("a")?.frontmatter.description).toBe("A doc");
    expect(index.byPath.get("sub/b")?.body).toContain("body B");
  });

  test("uses cache when mtimes unchanged", async () => {
    const { stone, pool } = await setupRefs();
    const poolRoot = poolKnowledgeDir(pool);
    await writeFile(join(poolRoot, "a.md"), `---\ndescription: A\n---\nbody A`);

    const first = await loadKnowledgeIndex({ stone, pool });
    const second = await loadKnowledgeIndex({ stone, pool });
    // 同一对象引用——证明走了 cache
    expect(first).toBe(second);
  });

  test("reloads when file mtime changes", async () => {
    const { stone, pool } = await setupRefs();
    const poolRoot = poolKnowledgeDir(pool);
    await writeFile(join(poolRoot, "a.md"), `---\ndescription: A v1\n---\nbody`);
    const v1 = await loadKnowledgeIndex({ stone, pool });
    expect(v1.byPath.get("a")?.frontmatter.description).toBe("A v1");

    await new Promise((r) => setTimeout(r, 5));
    await writeFile(join(poolRoot, "a.md"), `---\ndescription: A v2\n---\nbody`);
    const v2 = await loadKnowledgeIndex({ stone, pool });
    expect(v2.byPath.get("a")?.frontmatter.description).toBe("A v2");
    // 重新加载后是新对象
    expect(v2).not.toBe(v1);
  });

  test("reloads when new file added", async () => {
    const { stone, pool } = await setupRefs();
    const poolRoot = poolKnowledgeDir(pool);
    await writeFile(join(poolRoot, "a.md"), `---\ndescription: A\n---\nbody`);
    const v1 = await loadKnowledgeIndex({ stone, pool });
    expect(v1.byPath.size).toBe(1);

    await writeFile(join(poolRoot, "b.md"), `---\ndescription: B\n---\nbody`);
    const v2 = await loadKnowledgeIndex({ stone, pool });
    expect(v2.byPath.size).toBe(2);
  });

  // ------ 双源专属 smoke ------

  test("dual-source: loads seed (stone) and sediment (pool) together", async () => {
    const { stone, pool } = await setupRefs();
    // seed 侧：stone/<id>/knowledge/seed-x.md（createStoneObject 不预创建 knowledge 目录，需自己 mkdir）
    const seedRoot = stoneKnowledgeDir(stone);
    await mkdir(seedRoot, { recursive: true });
    await writeFile(
      join(seedRoot, "seed-x.md"),
      `---\ndescription: seed X\n---\nseed body`,
    );
    // sediment 侧：pool/<id>/knowledge/memory/sediment-y.md
    const memDir = join(poolKnowledgeDir(pool), "memory");
    await mkdir(memDir, { recursive: true });
    await writeFile(
      join(memDir, "sediment-y.md"),
      `---\ndescription: sediment Y\n---\nsediment body`,
    );

    const index = await loadKnowledgeIndex({ stone, pool });
    expect(index.byPath.size).toBe(2);
    expect(index.byPath.has("seed-x")).toBe(true);
    expect(index.byPath.has("memory/sediment-y")).toBe(true);
    expect(index.byPath.get("seed-x")?.body).toContain("seed body");
    expect(index.byPath.get("memory/sediment-y")?.body).toContain("sediment body");
  });

  test("dual-source: conflict on same idPath → sediment wins + console.warn", async () => {
    const { stone, pool } = await setupRefs();
    const seedRoot = stoneKnowledgeDir(stone);
    await mkdir(seedRoot, { recursive: true });
    await writeFile(join(seedRoot, "foo.md"), `---\ndescription: seed foo\n---\nseed`);
    const poolRoot = poolKnowledgeDir(pool);
    await writeFile(join(poolRoot, "foo.md"), `---\ndescription: sediment foo\n---\nsediment`);

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(" "));
    };
    try {
      const index = await loadKnowledgeIndex({ stone, pool });
      expect(index.byPath.size).toBe(1);
      // sediment 胜出
      expect(index.byPath.get("foo")?.body).toContain("sediment");
      expect(index.byPath.get("foo")?.frontmatter.description).toBe("sediment foo");
      expect(warnings.length).toBe(1);
      expect(warnings[0]).toContain("knowledge-loader");
      expect(warnings[0]).toContain("sediment_wins");
      expect(warnings[0]).toContain("foo");
    } finally {
      console.warn = origWarn;
    }
  });

  test("dual-source: stone-only fallback (no pool dir)", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    const stone: StoneObjectRef = { baseDir: tempRoot, objectId: "agent" };
    await createStoneObject(stone);
    const seedRoot = stoneKnowledgeDir(stone);
    await mkdir(seedRoot, { recursive: true });
    await writeFile(join(seedRoot, "only-seed.md"), `---\ndescription: seed\n---\nbody`);

    // pool ref 存在但目录不存在
    const index = await loadKnowledgeIndex({
      stone,
      pool: { baseDir: tempRoot, objectId: "agent" },
    });
    expect(index.byPath.size).toBe(1);
    expect(index.byPath.has("only-seed")).toBe(true);
  });

  test("dual-source: pool-only fallback (no stone knowledge dir)", async () => {
    const { stone, pool } = await setupRefs();
    // stone knowledge dir 不预创建（createStoneObject 不创建）
    const poolRoot = poolKnowledgeDir(pool);
    await writeFile(join(poolRoot, "only-sediment.md"), `---\ndescription: sed\n---\nbody`);

    const index = await loadKnowledgeIndex({ stone, pool });
    expect(index.byPath.size).toBe(1);
    expect(index.byPath.has("only-sediment")).toBe(true);
  });

  test("createStoneObject does NOT pre-create knowledge/ directory", async () => {
    // 设计断言：seed 是可选项，不预创（meta object.doc.ts seed_knowledge.todo 第 3 条）
    const { stone } = await setupRefs();
    const seedRoot = stoneKnowledgeDir(stone);
    // 不应存在
    const { existsSync } = await import("node:fs");
    expect(existsSync(seedRoot)).toBe(false);
    // 但 stone 目录本身存在
    expect(existsSync(stoneDir(stone))).toBe(true);
  });
});
