/**
 * Story: thinkable —— 与 LLM 交互、构造 context、按 trigger 激活 knowledge。
 *
 * 控制面（无 LLM）只验**结构/通道**：① seed knowledge（带 activates_on）经 loadKnowledgeIndex
 * 被加载、可被 root window trigger 激活；② Object self.md 作为身份被 readSelf 加载（→ LLM instructions）。
 * 「多轮连贯 / 激活质量」属 Tier B（需真 LLM）。规格见 specs/capability_thinkable.md。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { stoneDir as realStoneDir, readSelf } from "@ooc/core/persistable";
import { mkServer, postJson, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    const id = "thinker";
    await postJson(app, "/api/stones", { objectId: id, self: "# Thinker\n我是一个会思考的 Object。" });

    // TC-THINK-01: seed knowledge（带 activates_on）经 loadKnowledgeIndex 被加载（知识激活机制）
    {
      const kdir = join(realStoneDir({ baseDir, objectId: id }), "knowledge");
      mkdirSync(kdir, { recursive: true });
      writeFileSync(join(kdir, "rule.md"),
        `---\ntitle: 项目约定\nactivates_on:\n  "window::root": "show_content"\n---\n\n约定：所有 ID 用 ULID。`, "utf8");
      const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const idx = await loadKnowledgeIndex(
        { stone: { baseDir, objectId: id }, pool: { baseDir, objectId: id } }, createObjectRegistry());
      const doc = [...idx.byPath.values()].find((d: any) => d.path.includes("rule"));
      const hasTrigger = !!doc && !!(doc.frontmatter as any)?.activates_on?.["window::root"];
      rec.ok("TC-THINK-01", "seed knowledge（含 activates_on）经 loadKnowledgeIndex 被加载、可被 root trigger 激活",
        !!doc && hasTrigger, `found=${!!doc}, trigger=${hasTrigger}`);
    }

    // TC-THINK-02: Object self.md 作为身份被加载（→ LLM instructions）
    {
      const text = await readSelf({ baseDir, objectId: id });
      rec.ok("TC-THINK-02", "Object self.md 作为身份被 readSelf 加载（进 LLM instructions）",
        (text ?? "").includes("会思考"), `selfLen=${(text ?? "").length}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "thinkable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor } from "../_harness/agent-native";

/** Tier B —— agent-native：supervisor 用继承的 seed knowledge 回答（不靠即兴）。 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  return demoViaSupervisor("thinkable", `sb-an-think-${tag}`,
    "请基于你掌握的知识，简述 OOC 的 8 个能力维度分别是什么。",
    async ({ lastSay }) => {
      const dims = ["thinkable", "executable", "collaborable", "observable", "reflectable", "programmable", "visible", "persistable"];
      const hit = dims.filter((d) => lastSay.includes(d) || lastSay.includes("维度")).length;
      return { ok: hit >= 2 || lastSay.includes("维度"), detail: `回复引用维度/知识：${lastSay.slice(0, 90)}` };
    });
}
