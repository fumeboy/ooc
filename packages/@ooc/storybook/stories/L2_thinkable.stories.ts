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
    expectation: "root 协议知识（ROOT_KNOWLEDGE）列出可用 root method",
    design: "thinkable：root window 每轮注入协议知识，告诉 LLM 能调哪些 root method。builtins/root/executable",
    run: async () => {
      const { ROOT_KNOWLEDGE } = await import("@ooc/builtins/root");
      check(typeof ROOT_KNOWLEDGE === "string" && ROOT_KNOWLEDGE.length > 50, "ROOT_KNOWLEDGE 缺失");
      check(/talk/.test(ROOT_KNOWLEDGE) && /program/.test(ROOT_KNOWLEDGE), "ROOT_KNOWLEDGE 未列出 talk/program");
    },
  }),

  story({
    id: "L2-CONTEXT-WINDOW-TYPES",
    layer: "thinkable",
    expectation: "已注册 ObjectType 经 /api/windows/_shared/types 暴露 type + methods",
    design: "thinkable/executable：ContextObject 类型目录。modules/ui/api.list-window-types.ts",
    run: async ({ app }) => {
      const r = await getJson(app, "/api/windows/_shared/types");
      check(r.status === 200, `status=${r.status}`);
      const types = (r.json?.items ?? []).map((e: any) => e.type);
      check(types.includes("file") && types.includes("talk"), `types 缺 file/talk：${JSON.stringify(types)}`);
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
      check(paths.some((p) => p.includes("eight-dimensions")), `未继承 eight-dimensions：${JSON.stringify(paths)}`);
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
