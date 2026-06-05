import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureStoneRepo } from "@ooc/core/persistable";
import { createWorldRuntime, type WorldRuntime } from "@ooc/core/runtime/world-runtime";
import { createStonesService } from "./service";

/**
 * harness 首轮 sweep collaborable Bad 的 part (b)：非 dev server 里运行时新建的 stone
 * 不进 runtime ObjectRegistry（stone:changed→registerStone 被 config.dev 门控），只靠 lazy
 * loadObjectWindow-on-target。修复：createStone 经 runtime.registerStone 显式注册。
 */
describe("createStone 显式注册新 stone 进 ObjectRegistry（非 dev）", () => {
  let rt: WorldRuntime | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    await rt?.dispose();
    if (dir) rmSync(dir, { recursive: true, force: true });
    rt = undefined; dir = undefined;
  });

  test("createStone 后 runtime.objects.has(objectId) 为 true（修复前 false）", async () => {
    dir = mkdtempSync(join(tmpdir(), "ooc-reg-on-create-"));
    await ensureStoneRepo({ baseDir: dir });
    rt = createWorldRuntime({ worldPath: dir, dev: false });
    await rt.typeRegistration; // 等启动期注册 pass（此时尚无 expert）

    expect(rt.objects.has("expert")).toBe(false);

    const service = createStonesService({
      baseDir: dir,
      stoneRegistry: rt.stoneRegistry,
      registerStone: rt.registerStone,
    });
    await service.createStone({ objectId: "expert", self: "# Expert\n领域专家" });

    // 修复前：非 dev 无 hot-reload，expert 永不注册 → has=false
    expect(rt.objects.has("expert")).toBe(true);
  });
});
