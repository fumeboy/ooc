/**
 * L2 — Thinkable（上下文 / 知识 / thread）。
 * LLM 看到的是一组 ContextWindow 对象 + 沿 stone/pool 加载的 knowledge。
 * 质量类（激活精度、多轮连贯）需真 LLM → skip 归 Tier B；此处只断结构/通道。
 */
import { join } from "node:path";
import { postJson, getJson } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";

export const L2_STORIES: Story[] = [
  story({
    id: "L2-KNOWLEDGE-INDEX",
    layer: "thinkable",
    expectation: "对象 knowledge/*.md 经 loadKnowledgeIndex 可加载进索引",
    design: "thinkable：knowledge 沿 stone/pool 加载成可激活索引。thinkable/knowledge/loader.ts:loadKnowledgeIndex",
    run: async ({ app, baseDir }) => {
      const id = "doc_obj";
      await postJson(app, "/api/stones", { objectId: id, self: "# Doc" });
      const r = await postJson(app, `/api/pools/${id}/knowledge/files`, { path: "guide/intro.md", content: "# Intro\nhello" });
      check(r.status === 200, `创建 knowledge file status=${r.status}`);
      const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
      const idx = await loadKnowledgeIndex({ stone: { baseDir, objectId: id }, pool: { baseDir, objectId: id } });
      const paths = [...idx.byPath.keys()];
      check(paths.some((p) => p.includes("guide/intro")), `索引未含 guide/intro：${JSON.stringify(paths)}`);
    },
  }),

  story({
    id: "L2-ROOT-KNOWLEDGE",
    layer: "thinkable",
    expectation: "root method 菜单知识（root-methods.md）列出可用 root method",
    design: "thinkable：root window 按 activates_on 注入 builtins/root/knowledge/*.md；root-methods.md 列出能调哪些 root method。",
    run: async () => {
      const { readFileSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const md = readFileSync(
        join(dirname(Bun.resolveSync("@ooc/builtins/root/package.json", process.cwd())), "knowledge", "root-methods.md"),
        "utf8",
      );
      check(md.length > 50, "root-methods.md 缺失");
      // agency（talk）+ tool-object 成员方法（run = terminal/interpreter 跑代码，旧名 program 已退役）。
      check(/talk/.test(md) && /\brun\b/.test(md), "root-methods.md 未列出 talk/run");
    },
  }),

  story({
    id: "L2-KNOWLEDGE-INHERIT",
    layer: "thinkable",
    expectation: "instance 经 class 链继承框架 class 的 seed knowledge",
    design: "thinkable+class：knowledge 沿 parentClass 链回退继承。loader + 继承链",
    run: async ({ baseDir }) => {
      const { instantiateBuiltinClassObjects } = await import("@ooc/core/app/server/bootstrap/instantiate-classes");
      await instantiateBuiltinClassObjects({ baseDir });
      const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const reg = createObjectRegistry();
      reg.registerNewObjectType("_builtin/supervisor" as any, { methods: {} });
      reg.registerNewObjectType("supervisor" as any, { methods: {}, parentClass: "_builtin/supervisor" });
      const idx = await loadKnowledgeIndex({ stone: { baseDir, objectId: "supervisor" }, pool: { baseDir, objectId: "supervisor" } }, reg);
      const paths = [...idx.byPath.keys()];
      check(paths.some((p) => p.includes("nine-dimensions")), `未继承 nine-dimensions：${JSON.stringify(paths)}`);
    },
  }),

  story({
    id: "L2-CONTEXT-MULTITURN",
    layer: "thinkable",
    expectation: "多轮 context 连贯（窗口跨轮保留/压缩）——需真 LLM 多轮",
    design: "thinkable：thinkloop 多轮上下文连贯 + compress。需真 LLM，归 Tier B。",
    run: async () => skip("多轮 context 连贯质量需真 LLM thinkloop，控制面不可确定性验证（Tier B）"),
  }),
];
