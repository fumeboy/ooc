/**
 * 单元化 story catalog 的 bun:test 驱动 —— CI gate。
 *
 * 逐条 story 收为一个 `it`：起隔离 world → run（失败即 throw）→ 清理。
 * 与 `_control-plane.test.ts`（旧 9 能力大 story）并存；新预期一律加到 catalog。
 * 跑：`bun test packages/@ooc/storybook/stories`。
 */
import { describe, it } from "bun:test";
import { runStory } from "../_harness/story";
import { CATALOG } from "./_catalog";

// gate!==false 的进 CI gate（必须 PASS 或 SKIP）；gate:false 是已知待裁决差异，只进审计报告
// （catalog-runner），不卡 gate。skip() 在 runStory 里被容忍。
describe("storybook stories (unit-ized Tier A)", () => {
  for (const s of CATALOG.filter((s) => s.gate !== false)) {
    it(`${s.id} · ${s.expectation}`, async () => {
      await runStory(s);
    }, 60_000);
  }
});
