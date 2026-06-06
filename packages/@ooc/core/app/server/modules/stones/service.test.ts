import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureStoneRepo } from "@ooc/core/persistable";
import type { StoneRegistry } from "@ooc/core/runtime/stone-registry";
import { createStonesService } from "./service";

/** 只实现 listStones 用到的 rescan / listByKind 的最小 registry stub。 */
function stubRegistry(stones: { objectId: string; dir: string }[]): StoneRegistry {
  return {
    async rescan() {},
    listByKind(kind: string) {
      return kind === "stone"
        ? stones.map((s) => ({ objectId: s.objectId, kind: "stone", dir: s.dir }))
        : [];
    },
  } as unknown as StoneRegistry;
}

describe("stones service", () => {
  test("creates stone and reads/writes self (versioned through stone-versioning)", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-stones-"));

    try {
      // 根因 #2：HTTP createStone/putSelf 现在必经 stone-versioning（worktree → commit → ff merge），
      // 需要先 bootstrap stones/ git repo。
      await ensureStoneRepo({ baseDir });
      const service = createStonesService({ baseDir });
      const created = await service.createStone({ objectId: "agent" });
      expect(created.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(created.merged).toBe(true);

      const put = await service.putSelf({ objectId: "agent", text: "# agent" });
      expect(put.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(put.merged).toBe(true);

      const result = await service.getSelf({ objectId: "agent" });
      expect(result.text).toContain("agent");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("listStones merges builtin talk target supervisor in empty world (fs branch)", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-stones-"));
    try {
      await ensureStoneRepo({ baseDir });
      const service = createStonesService({ baseDir });

      // 全新 world，尚无任何用户 stone —— supervisor 仍应作为对话目标出现，
      // user（caller）不应出现。
      const ids = (await service.listStones()).items.map((it) => it.objectId);
      expect(ids).toContain("supervisor");
      expect(ids).not.toContain("user");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });

  test("listStones merges supervisor alongside user stones without duplication, sorted (registry branch)", async () => {
    // 真实 server 走 registry 分支。用户 stone 与 supervisor 并存：升序排列、不重复。
    const service = createStonesService({
      baseDir: "/tmp/unused",
      stoneRegistry: stubRegistry([{ objectId: "agent", dir: "/s/agent" }]),
    });
    const ids = (await service.listStones()).items.map((it) => it.objectId);
    expect(ids).toEqual(["agent", "supervisor"]);

    // 已存在同名 supervisor stone（用户覆盖）时不重复追加。
    const overridden = createStonesService({
      baseDir: "/tmp/unused",
      stoneRegistry: stubRegistry([
        { objectId: "supervisor", dir: "/s/supervisor" },
        { objectId: "agent", dir: "/s/agent" },
      ]),
    });
    const overriddenIds = (await overridden.listStones()).items.map((it) => it.objectId);
    expect(overriddenIds).toEqual(["agent", "supervisor"]);
  });
});
