import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createPoolObject,
  poolDir,
  poolMetadataFile,
  poolSqlDir,
  poolKnowledgeDir,
  poolKnowledgeMemoryDir,
  poolKnowledgeRelationsDir,
  poolKnowledgeRelationFile,
  poolFilesDir,
  readPoolRelation,
  derivePoolFromThread,
  POOL_OBJECTS_SUBDIR,
} from "../pool-object";

let tempRoot: string | undefined;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("pool-object: 路径函数 + createPoolObject", () => {
  test("路径都挂在 pools/objects/<id>/ 下（pool 不挂 branch）", () => {
    const ref = { baseDir: "/abs/world", objectId: "agent" };
    const expectedRoot = join("/abs/world", "pools", POOL_OBJECTS_SUBDIR, "agent");
    expect(poolDir(ref)).toBe(expectedRoot);
    expect(poolMetadataFile(ref)).toBe(join(expectedRoot, ".pool.json"));
    expect(poolSqlDir(ref)).toBe(join(expectedRoot, "sql"));
    expect(poolKnowledgeDir(ref)).toBe(join(expectedRoot, "knowledge"));
    expect(poolKnowledgeMemoryDir(ref)).toBe(join(expectedRoot, "knowledge", "memory"));
    expect(poolKnowledgeRelationsDir(ref)).toBe(join(expectedRoot, "knowledge", "relations"));
    expect(poolKnowledgeRelationFile(ref, "critic")).toBe(
      join(expectedRoot, "knowledge", "relations", "critic.md"),
    );
    expect(poolFilesDir(ref)).toBe(join(expectedRoot, "files"));
  });

  test("createPoolObject 创建完整骨架 + 写 .pool.json", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-pool-"));
    const ref = await createPoolObject({ baseDir: tempRoot, objectId: "alice" });

    for (const sub of ["sql", "knowledge", "knowledge/memory", "knowledge/relations", "files"]) {
      const stats = await stat(join(poolDir(ref), sub));
      expect(stats.isDirectory()).toBe(true);
    }

    const meta = JSON.parse(await readFile(poolMetadataFile(ref), "utf8"));
    expect(meta).toEqual({ type: "pool", objectId: "alice" });
  });

  test("readPoolRelation: 文件不存在 → undefined; 存在 → 文件正文", async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "ooc-pool-"));
    const ref = await createPoolObject({ baseDir: tempRoot, objectId: "alice" });
    expect(await readPoolRelation(ref, "critic")).toBeUndefined();

    const file = poolKnowledgeRelationFile(ref, "critic");
    await Bun.write(file, "我对 critic 的认知");
    expect(await readPoolRelation(ref, "critic")).toBe("我对 critic 的认知");
  });
});

describe("derivePoolFromThread", () => {
  test("从 ThreadPersistenceRef 派生 PoolObjectRef，不带 stonesBranch", () => {
    const threadRef = {
      baseDir: "/abs/world",
      sessionId: "s1",
      objectId: "alice",
      threadId: "t",
      stonesBranch: "metaprog/x",
    };
    const poolRef = derivePoolFromThread(threadRef);
    expect(poolRef).toEqual({ baseDir: "/abs/world", objectId: "alice" });
    // 显式断言 pool 不带 branch
    expect("stonesBranch" in poolRef).toBe(false);
  });
});
