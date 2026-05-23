import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { createPoolObject, poolKnowledgeDir, type PoolObjectRef } from "../../../persistable";
import { clearKnowledgeLoaderCache, loadKnowledgeIndex } from "../loader";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearKnowledgeLoaderCache();
});

describe("loadKnowledgeIndex", () => {
  test("empty knowledge directory returns empty index", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    const ref: PoolObjectRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const index = await loadKnowledgeIndex(ref);
    expect(index.byPath.size).toBe(0);
  });

  test("missing knowledge directory returns empty index", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    // 故意不 createPoolObject，knowledge dir 不存在
    const index = await loadKnowledgeIndex({ baseDir: tempRoot, objectId: "ghost" });
    expect(index.byPath.size).toBe(0);
  });

  test("scans multiple files including nested subdirectories", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    const ref: PoolObjectRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const root = poolKnowledgeDir(ref);
    await writeFile(
      join(root, "a.md"),
      `---
description: A doc
activates_on:
  show_content_when: [program]
---

body A`
    );
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(
      join(root, "sub", "b.md"),
      `---
description: B doc
---

body B`
    );

    const index = await loadKnowledgeIndex(ref);
    expect(index.byPath.size).toBe(2);
    expect(index.byPath.has("a")).toBe(true);
    expect(index.byPath.has("sub/b")).toBe(true);
    expect(index.byPath.get("a")?.frontmatter.description).toBe("A doc");
    expect(index.byPath.get("sub/b")?.body).toContain("body B");
  });

  test("uses cache when mtimes unchanged", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    const ref: PoolObjectRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const root = poolKnowledgeDir(ref);
    await writeFile(join(root, "a.md"), `---\ndescription: A\n---\nbody A`);

    const first = await loadKnowledgeIndex(ref);
    const second = await loadKnowledgeIndex(ref);
    // 同一对象引用——证明走了 cache
    expect(first).toBe(second);
  });

  test("reloads when file mtime changes", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    const ref: PoolObjectRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const root = poolKnowledgeDir(ref);
    await writeFile(join(root, "a.md"), `---\ndescription: A v1\n---\nbody`);
    const v1 = await loadKnowledgeIndex(ref);
    expect(v1.byPath.get("a")?.frontmatter.description).toBe("A v1");

    await new Promise((r) => setTimeout(r, 5));
    await writeFile(join(root, "a.md"), `---\ndescription: A v2\n---\nbody`);
    const v2 = await loadKnowledgeIndex(ref);
    expect(v2.byPath.get("a")?.frontmatter.description).toBe("A v2");
    // 重新加载后是新对象
    expect(v2).not.toBe(v1);
  });

  test("reloads when new file added", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-kn-"));
    const ref: PoolObjectRef = await createPoolObject({ baseDir: tempRoot, objectId: "agent" });
    const root = poolKnowledgeDir(ref);
    await writeFile(join(root, "a.md"), `---\ndescription: A\n---\nbody`);
    const v1 = await loadKnowledgeIndex(ref);
    expect(v1.byPath.size).toBe(1);

    await writeFile(join(root, "b.md"), `---\ndescription: B\n---\nbody`);
    const v2 = await loadKnowledgeIndex(ref);
    expect(v2.byPath.size).toBe(2);
  });
});
