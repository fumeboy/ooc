import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stoneDir, STONES_MAIN_BRANCH } from "./common";
import {
  isCanonicalObject,
  resolveSuperActor,
  SUPER_ACTOR_FALLBACK,
} from "./super-actor";

/** 在 stones/main/objects/<nestedPath>/ 造一个 canonical 对象目录（与 ensureAuthorExists 同寻址）。 */
async function makeCanonical(baseDir: string, objectId: string): Promise<void> {
  await mkdir(stoneDir({ baseDir, objectId, _stonesBranch: STONES_MAIN_BRANCH }), { recursive: true });
}

describe("resolveSuperActor（super-flow actor 冒泡）", () => {
  test("canonical self → 返回自身（透明，行为不变）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-superactor-"));
    try {
      await makeCanonical(baseDir, "alice");
      expect(await isCanonicalObject(baseDir, "alice")).toBe(true);
      expect(await resolveSuperActor(baseDir, "alice")).toBe("alice");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("nested 新对象 → 冒泡到最近 canonical 祖先", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-superactor-"));
    try {
      // "alice/bob" canonical（parent），"alice/bob/carol" 是 session 内新对象（未 canonical）
      await makeCanonical(baseDir, "alice/bob");
      expect(await isCanonicalObject(baseDir, "alice/bob/carol")).toBe(false);
      expect(await resolveSuperActor(baseDir, "alice/bob/carol")).toBe("alice/bob");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("nested 新对象 → 跳过非 canonical 中间层，取更高 canonical 祖先", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-superactor-"));
    try {
      // 只有顶层 "alice" canonical；"alice/bob"、"alice/bob/carol" 都新
      await makeCanonical(baseDir, "alice");
      expect(await resolveSuperActor(baseDir, "alice/bob/carol")).toBe("alice");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("顶层新对象（无路径 parent）→ supervisor 兜底", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-superactor-"));
    try {
      expect(await isCanonicalObject(baseDir, "bar")).toBe(false);
      expect(await resolveSuperActor(baseDir, "bar")).toBe(SUPER_ACTOR_FALLBACK);
      expect(SUPER_ACTOR_FALLBACK).toBe("supervisor");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("nested 一路无 canonical 祖先 → supervisor 兜底", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-superactor-"));
    try {
      // 空 world：a/b/c 整条链都不 canonical
      expect(await resolveSuperActor(baseDir, "a/b/c")).toBe(SUPER_ACTOR_FALLBACK);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("canonical self 优先于祖先（自身 canonical 时不冒泡）", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-superactor-"));
    try {
      await makeCanonical(baseDir, "alice");
      await makeCanonical(baseDir, "alice/bob");
      expect(await resolveSuperActor(baseDir, "alice/bob")).toBe("alice/bob");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
