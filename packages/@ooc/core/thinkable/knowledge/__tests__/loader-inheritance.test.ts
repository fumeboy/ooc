import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createPoolObject,
  createStoneObject,
  stoneKnowledgeDir,
  type PoolObjectRef,
  type StoneObjectRef,
} from "../../../persistable";
import { clearKnowledgeLoaderCache, loadKnowledgeIndex } from "../loader";

/**
 * B-tree knowledge 继承测试。
 *
 * 验证：
 * 1. 父 Agent 的 knowledge 仅在 frontmatter `inheritable: true` 时被子 Agent 看到
 * 2. 子 Agent 自己的同 idPath knowledge override 父级
 * 3. 多级祖先：更近的祖先 override 更远的（CSS-cascade）
 * 4. 父 Agent 的 sediment（pool）不会被下传给子 Agent
 */

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
  clearKnowledgeLoaderCache();
});

async function newRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ooc-kn-inh-"));
  tempRoot = root;
  return root;
}

async function writeKnowledge(stoneRef: StoneObjectRef, slug: string, body: string): Promise<void> {
  const dir = stoneKnowledgeDir(stoneRef);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${slug}.md`), body, "utf8");
}

describe("loadKnowledgeIndex 继承（B-tree）", () => {
  test("inheritable=true 的父 knowledge 被子 Agent 自动纳入索引", async () => {
    const root = await newRoot();
    const parentRef: StoneObjectRef = { baseDir: root, objectId: "parent" };
    const childRef: StoneObjectRef = { baseDir: root, objectId: "parent/child" };
    await createStoneObject(parentRef);
    await createStoneObject(childRef);
    const childPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "parent/child",
    });

    await writeKnowledge(
      parentRef,
      "shared",
      "---\ntitle: shared\ninheritable: true\n---\nshared body\n",
    );

    const index = await loadKnowledgeIndex({ stone: childRef, pool: childPool });
    expect(index.byPath.has("shared")).toBe(true);
    expect(index.byPath.get("shared")!.body).toBe("shared body\n");
  });

  test("inheritable 缺省（视为 false）的父 knowledge 不下传", async () => {
    const root = await newRoot();
    const parentRef: StoneObjectRef = { baseDir: root, objectId: "parent" };
    const childRef: StoneObjectRef = { baseDir: root, objectId: "parent/child" };
    await createStoneObject(parentRef);
    await createStoneObject(childRef);
    const childPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "parent/child",
    });

    // inheritable 缺省
    await writeKnowledge(parentRef, "private", "---\ntitle: private\n---\nprivate body\n");

    const index = await loadKnowledgeIndex({ stone: childRef, pool: childPool });
    expect(index.byPath.has("private")).toBe(false);
  });

  test("inheritable=false 显式禁止下传", async () => {
    const root = await newRoot();
    const parentRef: StoneObjectRef = { baseDir: root, objectId: "parent" };
    const childRef: StoneObjectRef = { baseDir: root, objectId: "parent/child" };
    await createStoneObject(parentRef);
    await createStoneObject(childRef);
    const childPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "parent/child",
    });

    await writeKnowledge(
      parentRef,
      "private",
      "---\ntitle: private\ninheritable: false\n---\nbody\n",
    );

    const index = await loadKnowledgeIndex({ stone: childRef, pool: childPool });
    expect(index.byPath.has("private")).toBe(false);
  });

  test("子 Agent 的同 idPath knowledge override 父级", async () => {
    const root = await newRoot();
    const parentRef: StoneObjectRef = { baseDir: root, objectId: "parent" };
    const childRef: StoneObjectRef = { baseDir: root, objectId: "parent/child" };
    await createStoneObject(parentRef);
    await createStoneObject(childRef);
    const childPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "parent/child",
    });

    await writeKnowledge(
      parentRef,
      "shared",
      "---\ntitle: parent\ninheritable: true\n---\nparent body\n",
    );
    await writeKnowledge(
      childRef,
      "shared",
      "---\ntitle: child\n---\nchild body\n",
    );

    const index = await loadKnowledgeIndex({ stone: childRef, pool: childPool });
    expect(index.byPath.get("shared")!.body).toBe("child body\n");
    expect(index.byPath.get("shared")!.frontmatter.title).toBe("child");
  });

  test("多级祖先：更近的祖先 override 更远的", async () => {
    const root = await newRoot();
    const grandRef: StoneObjectRef = { baseDir: root, objectId: "grand" };
    const parentRef: StoneObjectRef = { baseDir: root, objectId: "grand/parent" };
    const childRef: StoneObjectRef = { baseDir: root, objectId: "grand/parent/child" };
    await createStoneObject(grandRef);
    await createStoneObject(parentRef);
    await createStoneObject(childRef);
    const childPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "grand/parent/child",
    });

    await writeKnowledge(
      grandRef,
      "doc",
      "---\ntitle: from-grand\ninheritable: true\n---\ngrand body\n",
    );
    await writeKnowledge(
      parentRef,
      "doc",
      "---\ntitle: from-parent\ninheritable: true\n---\nparent body\n",
    );
    // child 自己没写

    const index = await loadKnowledgeIndex({ stone: childRef, pool: childPool });
    expect(index.byPath.get("doc")!.body).toBe("parent body\n");
    expect(index.byPath.get("doc")!.frontmatter.title).toBe("from-parent");
  });

  test("祖先 pool（sediment）不下传", async () => {
    const root = await newRoot();
    const parentRef: StoneObjectRef = { baseDir: root, objectId: "parent" };
    const childRef: StoneObjectRef = { baseDir: root, objectId: "parent/child" };
    await createStoneObject(parentRef);
    await createStoneObject(childRef);
    const parentPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "parent",
    });
    const childPool: PoolObjectRef = await createPoolObject({
      baseDir: root,
      objectId: "parent/child",
    });

    // 在父 pool 写一份 memory 文件（即便加 inheritable: true，也不应被下传——
    // loader 不扫祖先 pool）
    const parentMemDir = join(parentPool.baseDir, "pools", "objects", "parent", "knowledge", "memory");
    await mkdir(parentMemDir, { recursive: true });
    await writeFile(
      join(parentMemDir, "secret.md"),
      "---\ntitle: secret\ninheritable: true\n---\nsediment body\n",
      "utf8",
    );

    const index = await loadKnowledgeIndex({ stone: childRef, pool: childPool });
    expect(index.byPath.has("memory/secret")).toBe(false);
  });

  test("顶层 Agent 没有祖先 → 行为退化为单源（与既有语义一致）", async () => {
    const root = await newRoot();
    const ref: StoneObjectRef = { baseDir: root, objectId: "lonely" };
    await createStoneObject(ref);
    const poolRef: PoolObjectRef = await createPoolObject({ baseDir: root, objectId: "lonely" });

    await writeKnowledge(ref, "self", "---\ntitle: self\n---\nself body\n");

    const index = await loadKnowledgeIndex({ stone: ref, pool: poolRef });
    expect(index.byPath.size).toBe(1);
    expect(index.byPath.get("self")!.body).toBe("self body\n");
  });
});
