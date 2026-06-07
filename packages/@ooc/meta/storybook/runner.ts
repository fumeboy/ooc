/**
 * Storybook runner —— 聚合 9 个 story，产出能力覆盖矩阵 + dashboard。
 *
 * Tier A（control-plane，确定性）：始终跑，任一 FAIL → exit 1（同 `test:storybook` 的 gate）。
 * Tier B（agent-native，真 LLM）：env `RUN_STORYBOOK_AGENT=1` + LLM 凭证齐备时才跑（见 Phase 2）。
 *
 * Run:
 *   bun run packages/@ooc/meta/storybook/runner.ts
 *   RUN_STORYBOOK_AGENT=1 bun run packages/@ooc/meta/storybook/runner.ts   # 含 Tier B
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CAPABILITIES, type CapabilityId, type StoryResult } from "./_harness/types";

import { runControlPlane as thinkable } from "./stories/thinkable.story";
import { runControlPlane as executable } from "./stories/executable.story";
import { runControlPlane as collaborable } from "./stories/collaborable.story";
import { runControlPlane as observable } from "./stories/observable.story";
import { runControlPlane as reflectable } from "./stories/reflectable.story";
import { runControlPlane as programmable } from "./stories/programmable.story";
import { runControlPlane as visible } from "./stories/visible.story";
import { runControlPlane as persistable } from "./stories/persistable.story";
import { runControlPlane as klass } from "./stories/class.story";

const CONTROL_PLANE: Record<CapabilityId, () => Promise<StoryResult>> = {
  thinkable, executable, collaborable, observable, reflectable, programmable, visible, persistable, class: klass,
};

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs", "ooc-6", "storybook");

function counts(r: StoryResult) {
  return {
    pass: r.tcs.filter((t) => t.status === "PASS").length,
    fail: r.tcs.filter((t) => t.status === "FAIL").length,
    skip: r.tcs.filter((t) => t.status === "SKIP").length,
  };
}
const TIER_MARK: Record<string, string> = { Good: "🟢 Good", OK: "🟡 OK", Bad: "🔴 Bad" };

async function main() {
  const agentEnabled = process.env.RUN_STORYBOOK_AGENT === "1";
  console.log(`=== Storybook runner ===  Tier A: 确定性  |  Tier B(agent-native): ${agentEnabled ? "on" : "off (RUN_STORYBOOK_AGENT=1 启用)"}\n`);

  const results: Array<{ cap: CapabilityId; a: StoryResult }> = [];
  for (const cap of CAPABILITIES) {
    const a = await CONTROL_PLANE[cap]();
    const c = counts(a);
    console.log(`${TIER_MARK[a.storyTier]}  ${cap.padEnd(13)} Tier A: ${c.pass}P/${c.fail}F/${c.skip}S`);
    results.push({ cap, a });
  }

  // 覆盖矩阵 markdown
  const rows = results.map(({ cap, a }) => {
    const c = counts(a);
    return `| ${cap} | ${TIER_MARK[a.storyTier]} | ${c.pass}/${c.fail}/${c.skip} | ${agentEnabled ? "（见 Tier B 报告）" : "—（env-gated）"} |`;
  });
  const totalFail = results.reduce((n, r) => n + counts(r.a).fail, 0);
  const md = [
    `# Storybook 覆盖矩阵 / dashboard`,
    ``,
    `> runner 产物（自动生成）。Tier A = 控制面确定性（可 CI）；Tier B = agent-native（真 LLM，env-gated）。`,
    `> 生成方式：\`bun run packages/@ooc/meta/storybook/runner.ts\`。`,
    ``,
    `**Tier A 汇总**：${results.length} 特性，FAIL=${totalFail}。${totalFail === 0 ? "✅ 全绿（CI gate 通过）" : "🔴 有 FAIL"}`,
    ``,
    `| 能力 | Tier A 档位 | A: PASS/FAIL/SKIP | Tier B（agent-native） |`,
    `|---|---|---|---|`,
    ...rows,
    ``,
    `_注：SKIP 多为环境依赖（如 visible 的 Vite serve 需 live Vite 指向同 world）。Tier B 质量判据见各 spec。_`,
  ].join("\n");

  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(join(DOCS_DIR, "dashboard.md"), md + "\n", "utf8");
  writeFileSync(join(import.meta.dir, "_results.json"),
    JSON.stringify(results.map(({ cap, a }) => ({ cap, tierA: { storyTier: a.storyTier, ...counts(a) } })), null, 2) + "\n", "utf8");

  console.log(`\n[storybook-runner] dashboard → ${join(DOCS_DIR, "dashboard.md")}`);
  console.log(`[e2e-score] ${JSON.stringify({ suite: "storybook", tierAFail: totalFail })}`);
  if (totalFail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
