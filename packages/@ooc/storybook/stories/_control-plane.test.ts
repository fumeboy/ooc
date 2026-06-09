/**
 * Tier A（control-plane）确定性套件 —— 被 `bun test` 收，作为 CI gate。
 *
 * 每个能力一个 `it`：跑该 story 的 runControlPlane()，断言无 FAIL（SKIP 容忍）。
 * 纯 story 模块（*.story.ts）同时被 runner.ts 直接 import 做聚合矩阵。
 */
import { describe, expect, it } from "bun:test";
import { runControlPlane as thinkable } from "./thinkable.story";
import { runControlPlane as executable } from "./executable.story";
import { runControlPlane as collaborable } from "./collaborable.story";
import { runControlPlane as observable } from "./observable.story";
import { runControlPlane as reflectable } from "./reflectable.story";
import { runControlPlane as programmable } from "./programmable.story";
import { runControlPlane as visible } from "./visible.story";
import { runControlPlane as persistable } from "./persistable.story";
import { runControlPlane as klass } from "./class.story";
import type { StoryResult } from "../_harness/types";

const STORIES: Array<[string, () => Promise<StoryResult>]> = [
  ["thinkable", thinkable],
  ["executable", executable],
  ["collaborable", collaborable],
  ["observable", observable],
  ["reflectable", reflectable],
  ["programmable", programmable],
  ["visible", visible],
  ["persistable", persistable],
  ["class", klass],
];

describe("storybook control-plane (Tier A)", () => {
  for (const [name, run] of STORIES) {
    it(`${name}: 无 FAIL`, async () => {
      const r = await run();
      const failed = r.tcs.filter((t) => t.status === "FAIL").map((f) => `${f.id}: ${f.detail}`);
      expect(failed).toEqual([]);
    }, 60_000);
  }
});
