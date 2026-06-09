/**
 * 单元化 story catalog —— 聚合所有 L<n>_<layer>.stories.ts。
 *
 * 每条 story 是一个独立预期（见 docs/ooc-6/storybook/stories-outline.md）。
 * 被 stories/_catalog.test.ts（CI gate，gate!==false 的进 gate）逐条收为 bun:test `it`；
 * 被 catalog-runner.ts 全量跑出 PASS/FAIL/SKIP 审计报告（docs/ooc-6/storybook/stories-report.md）。
 */
import type { Story } from "../_harness/story";
import { L0_STORIES } from "./L0_world.stories";
import { L1_STORIES } from "./L1_session.stories";
import { L2_STORIES } from "./L2_thinkable.stories";
import { L3_STORIES } from "./L3_executable.stories";
import { L4_STORIES } from "./L4_collaborable.stories";
import { L5_STORIES } from "./L5_observable.stories";
import { L6_STORIES } from "./L6_reflectable.stories";
import { L7_STORIES } from "./L7_programmable.stories";
import { L8_STORIES } from "./L8_visible.stories";
import { L9_STORIES } from "./L9_class.stories";

export const CATALOG: Story[] = [
  ...L0_STORIES,
  ...L1_STORIES,
  ...L2_STORIES,
  ...L3_STORIES,
  ...L4_STORIES,
  ...L5_STORIES,
  ...L6_STORIES,
  ...L7_STORIES,
  ...L8_STORIES,
  ...L9_STORIES,
];
