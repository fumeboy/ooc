import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { createStonesService } from "./service";

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

  test("createStone writes ooc.class into package.json when class is provided", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "ooc-stones-"));
    try {
      await ensureStoneRepo({ baseDir });
      const service = createStonesService({ baseDir });
      await service.createStone({ objectId: "child", self: "# child", class: "_builtin/supervisor" });

      const { readFile } = await import("node:fs/promises");
      const { stoneDir } = await import("@ooc/core/persistable");
      const pkg = JSON.parse(
        await readFile(join(stoneDir({ baseDir, objectId: "child" }), "package.json"), "utf8"),
      );
      expect(pkg.ooc.class).toBe("_builtin/supervisor");
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  });
});
