/**
 * 单元化 story 审计 runner —— 全量跑 catalog，产出 PASS/FAIL/SKIP 报告。
 *
 * 与 `_catalog.test.ts`（CI gate，只收 gate!==false）不同：本 runner **全跑**，把每条预期的
 * 三态 + 失败详情写进 `docs/ooc-6/storybook/stories-report.md`，供人裁决「设计 vs 预期」差异。
 * 它**不** exit 1（审计工具，不是 gate）——FAIL 是要给人看的信号，不是要挡住流水线。
 *
 * Run: bun run packages/@ooc/storybook/catalog-runner.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "./stories/_catalog";
import { runStoryCaptured, type StoryStatus } from "./_harness/story";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs", "ooc-6", "storybook");
const MARK: Record<StoryStatus, string> = { PASS: "🟢 PASS", FAIL: "🔴 FAIL", SKIP: "⬜ SKIP" };

async function main() {
  const results: Array<{ id: string; layer: string; expectation: string; design: string; status: StoryStatus; detail?: string; gate: boolean; divergence?: string }> = [];
  for (const s of CATALOG) {
    const r = await runStoryCaptured(s);
    const mark = MARK[r.status];
    console.log(`${mark}  ${s.id.padEnd(26)} ${s.expectation}${r.detail ? `\n        ${r.detail}` : ""}`);
    results.push({ id: s.id, layer: s.layer, expectation: s.expectation, design: s.design, status: r.status, detail: r.detail, gate: s.gate !== false, divergence: s.divergence });
  }

  const n = (st: StoryStatus) => results.filter((r) => r.status === st).length;
  const layers = [...new Set(results.map((r) => r.layer))];

  const lines: string[] = [
    `# Storybook Stories 执行报告（单元化 Tier A）`,
    ``,
    `> catalog-runner 产物（自动生成）。每条 story = 一个简单稳定预期；本报告记录其在控制面（零真 LLM）下的三态。`,
    `> 生成：\`bun run packages/@ooc/storybook/catalog-runner.ts\`。大纲：\`stories-outline.md\`。`,
    ``,
    `**汇总**：${results.length} 条 · 🟢 PASS ${n("PASS")} · 🔴 FAIL ${n("FAIL")} · ⬜ SKIP ${n("SKIP")}`,
    ``,
    `- **PASS**：控制面确定性验证通过——该 OOC 设计点按预期工作。`,
    `- **FAIL**：预期与实现有**差异**，待人裁决（改实现 or 改预期）。`,
    `- **SKIP**：该预期控制面不可确定性验证（需 worker/真 LLM/live Vite），归 Tier B / e2e。`,
    ``,
  ];

  if (n("FAIL") > 0) {
    lines.push(`## 🔴 待裁决差异（FAIL）`, ``, `| id | 预期 | 失败详情 | 锚定设计 |`, `|---|---|---|---|`);
    for (const r of results.filter((r) => r.status === "FAIL")) {
      lines.push(`| ${r.id} | ${r.expectation} | ${(r.detail ?? "").replace(/\|/g, "\\|").slice(0, 160)} | ${r.design.replace(/\|/g, "\\|")} |`);
    }
    lines.push(``);
  }

  for (const layer of layers) {
    lines.push(`## ${layer}`, ``, `| 状态 | id | 预期 | 详情 / SKIP 原因 |`, `|---|---|---|---|`);
    for (const r of results.filter((r) => r.layer === layer)) {
      lines.push(`| ${MARK[r.status]} | ${r.id} | ${r.expectation} | ${(r.detail ?? "").replace(/\|/g, "\\|").slice(0, 120)} |`);
    }
    lines.push(``);
  }

  lines.push(
    `## 设计锚点对照`,
    ``,
    `| id | 锚定的 OOC 设计 |`,
    `|---|---|`,
    ...results.map((r) => `| ${r.id} | ${r.design.replace(/\|/g, "\\|")} |`),
    ``,
  );

  mkdirSync(DOCS_DIR, { recursive: true });
  writeFileSync(join(DOCS_DIR, "stories-report.md"), lines.join("\n") + "\n", "utf8");
  console.log(`\n[catalog-runner] 汇总 PASS=${n("PASS")} FAIL=${n("FAIL")} SKIP=${n("SKIP")} → ${join(DOCS_DIR, "stories-report.md")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
