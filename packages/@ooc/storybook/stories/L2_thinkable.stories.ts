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
    id: "L2-KNOWLEDGE-INHERIT",
    layer: "thinkable",
    expectation: "object 经 ooc.class 单跳继承其 class 的 seed knowledge",
    design:
      "thinkable+object 模型：object 经 ooc.class 继承一个 class（对象模型核心 2），其 class 的 seed knowledge 无条件流向 instance。" +
      "loader.ts:loadKnowledgeIndex Step 1b（parentClass 链 seed，单跳）+ object-registry.ts:resolveParentClassChain（单跳）。",
    run: async ({ baseDir }) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { loadKnowledgeIndex } = await import("@ooc/core/thinkable/knowledge/loader");
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const { stoneKnowledgeDir } = await import("@ooc/core/persistable");

      // class（被继承）+ instance（经 parentClass 单跳继承该 class）。
      const reg = createObjectRegistry();
      reg.register("base_role", { executable: { methods: [] } } as never, { parentClass: null });
      reg.register("my_agent", { executable: { methods: [] } } as never, { parentClass: "base_role" });
      check(
        JSON.stringify(reg.resolveParentClassChain("my_agent")) === JSON.stringify(["base_role"]),
        `parentClass 链应单跳 [base_role]：${JSON.stringify(reg.resolveParentClassChain("my_agent"))}`,
      );

      // class 的 seed knowledge 落其 stone knowledge 目录。
      const classKnowledgeDir = stoneKnowledgeDir({ baseDir, objectId: "base_role" } as never);
      await mkdir(classKnowledgeDir, { recursive: true });
      await writeFile(
        join(classKnowledgeDir, "nine-dimensions.md"),
        "---\ntitle: 九维度\n---\nthinkable / executable / …",
        "utf8",
      );

      // instance 加载时无条件继承 class 的 seed knowledge（Step 1b 不门控 inheritable）。
      const idx = await loadKnowledgeIndex(
        { stone: { baseDir, objectId: "my_agent" }, pool: { baseDir, objectId: "my_agent" } },
        reg,
      );
      const paths = [...idx.byPath.keys()];
      check(paths.some((p) => p.includes("nine-dimensions")), `未继承 class 的 nine-dimensions：${JSON.stringify(paths)}`);
    },
  }),

  story({
    id: "L2-COMPRESS-WINDOW-METHOD",
    layer: "thinkable",
    expectation: "compress/expand 作为通用默认 window method：写入侧 resolveWindowMethod 回退默认表 + 改 compressLevel；读出侧 renderer 按档位投影变短",
    design:
      "compress 下沉为通用 window method（readable/default-window-methods.ts:DEFAULT_WINDOW_METHODS），" +
      "object-registry.ts:resolveWindowMethod 在 class 自有声明未命中时回退默认表；" +
      "读出侧 thinkable/context/renderers/xml.ts:projectByCompressLevel 按 win.compressLevel 投影详略（0 全文 / 1 缩略 / 2 仅句柄）。",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const { projectByCompressLevel } = await import("@ooc/core/thinkable/context/renderers/xml");
      const { xmlElement, xmlText, serializeXml } = await import("@ooc/core/_shared/types/xml");

      // 写入侧：class 无 compress 声明 → resolveWindowMethod 回退默认表。
      const reg = createObjectRegistry();
      reg.register("plain_win", { executable: { methods: [] } } as never, { parentClass: null });
      const compress = reg.resolveWindowMethod("plain_win", "compress");
      const expand = reg.resolveWindowMethod("plain_win", "expand");
      check(!!compress && !!expand, "compress/expand 未从默认表解析（resolveWindowMethod 回退缺失）");

      // exec 改档：0→1 递进、封顶 2；expand 反向 1→0（纯投影态、不可变）。
      const up1 = (await compress!.exec({} as never, {}, { compressLevel: 0 } as never, {} as never)) as { compressLevel: number };
      check(up1.compressLevel === 1, `compress 应 0→1，得 ${up1.compressLevel}`);
      const cap = (await compress!.exec({} as never, {}, { compressLevel: 2 } as never, {} as never)) as { compressLevel: number };
      check(cap.compressLevel === 2, `compress 应封顶 2，得 ${cap.compressLevel}`);
      const down = (await expand!.exec({} as never, {}, { compressLevel: 1 } as never, {} as never)) as { compressLevel: number };
      check(down.compressLevel === 0, `expand 应 1→0，得 ${down.compressLevel}`);

      // 读出侧：长内容 level 0 原样、level 2 仅句柄 → 显著变短（可逆闭环）。
      const long = [xmlElement("readable", {}, [xmlText("x".repeat(500))])];
      const full = serializeXml(xmlElement("window", {}, projectByCompressLevel(long, 0)));
      const folded = serializeXml(xmlElement("window", {}, projectByCompressLevel(long, 2)));
      check(full.includes("x".repeat(500)), "level 0 应原样含全文");
      check(folded.length < full.length, `level 2 投影应比 level 0 短：full=${full.length} folded=${folded.length}`);
      check(!folded.includes("x".repeat(500)), "level 2 不应再含全文（已折为句柄）");
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
