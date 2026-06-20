/**
 * Story: thinkable —— 与 LLM 交互、构造 context、按 trigger 激活 knowledge。
 *
 * 控制面（无 LLM）只验**结构/通道**：① seed knowledge（带 activates_on）经 loadKnowledgeIndex
 * 被加载、可被 root window trigger 激活；② Object self.md 作为身份被 readSelf 加载（→ self 门面窗 self 视角内容，非 instructions）。
 * 「多轮连贯 / 激活质量」属 Tier B（需真 LLM）。规格见 thinkable 对象 knowledge/tests.md（.ooc-world-meta）。
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

    // TC-THINK-02: Object self.md 作为身份被加载（→ self 门面窗 self 视角内容，非 instructions）
    {
      const text = await readSelf({ baseDir, objectId: id });
      rec.ok("TC-THINK-02", "Object self.md 作为身份被 readSelf 加载（渲为 self 门面窗 self 视角内容，非 instructions）",
        (text ?? "").includes("会思考"), `selfLen=${(text ?? "").length}`);
    }

    // TC-THINK-03: class 声明层（<window_classes>/<class>）渲染 method 的语义 description（非仅 name/paths）。
    // 回归守卫：曾经只渲 paths.join(",")（≈ method 名），LLM 看不懂每个 method 含义。
    // 方法菜单已从逐实例 <methods> 搬到 class 声明层一次（computeVisibleMethodSet）。
    //
    // Wave4 对象模型：registry 存 RegisteredClass（executable.methods + readable.window[].window_methods），
    // 不再有旧 getObjectDefinition({methods,windowMethods})。file 投影窗 ownerClass="filesystem/file"、
    // projectionClass="file"。computeVisibleMethodSet(ownerClass, projectionClass, thread, registry)。
    {
      await import("@ooc/core/runtime/register-builtins.js"); // boot builtin registry
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      const { computeVisibleMethodSet } = await import("@ooc/core/thinkable/context/renderers/xml");
      const { extractBasicDescription } = await import(
        "@ooc/core/thinkable/context/method-description.js"
      );
      const ownerClass = "filesystem/file";
      const projectionClass = "file";
      const cls = builtinRegistry.getClass(ownerClass);
      // 候选 method：该投影窗声明的 object method（沿继承链）+ window method，里挑一个有 *_BASIC 描述的。
      const decl = cls?.readable?.window?.find((w) => w.class === projectionClass);
      const objMethods = new Map(
        builtinRegistry.resolveObjectMethods(ownerClass).map((m) => [m.name, m as any]),
      );
      const candidates = [
        ...(decl?.object_methods ?? []).map((n) => objMethods.get(n)).filter(Boolean),
        ...(decl?.window_methods ?? []),
      ];
      let descMethod = "";
      let snippet = "";
      for (const entry of candidates) {
        const d = extractBasicDescription(entry as any);
        if (d && d.trim().length > 0) {
          descMethod = (entry as any).name;
          // 折叠空白、去引号后取片段，与 conciseDescription 对齐
          snippet = d.replace(/\s+/g, " ").replace(/["\\]/g, "").trim().slice(0, 16);
          break;
        }
      }
      const thread = { persistence: { sessionId: "tc-think-03" } } as never;
      const set = computeVisibleMethodSet(ownerClass, projectionClass, thread, builtinRegistry);
      const serialized = JSON.stringify(set?.methodNodes ?? []);
      // description 文本片段须出现在 class 声明的 method 节点里——否则说明又退回只渲 name/paths
      const descRendered = descMethod !== "" && snippet.length > 0 && serialized.includes(snippet);
      rec.ok(
        "TC-THINK-03",
        "class 声明层 <class> 渲染 method 语义 description（非仅 name/paths，防回归）",
        descRendered,
        `method=${descMethod || "<none-with-desc>"}, snippet=${JSON.stringify(snippet)}, rendered=${descRendered}`,
      );
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
