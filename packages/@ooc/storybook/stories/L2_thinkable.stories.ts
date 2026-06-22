/**
 * L2 — Thinkable（上下文 / 知识 / thread）。
 * LLM 看到的是一组 ContextWindow 对象 + 沿 stone/pool 加载的 knowledge。
 * 质量类（激活精度、多轮连贯）需真 LLM → skip 归 Tier B；此处只断结构/通道。
 */
import { join } from "node:path";
import { postJson, getJson } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";
import { makeReadonlySelfProxy } from "@ooc/core/runtime/self-proxy.js";

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
    id: "L2-RESIZE-DISPLAY",
    layer: "thinkable",
    expectation:
      "compress v2 协议：内容窗经 class 自声明 resize 设展示档位 compressLevel（无通用默认）；读出侧 projectByCompressLevel 按档位投影变短",
    design:
      "compress v2：无通用默认窗方法表（default-window-methods 已删）。内容窗（file/search/…）各自在自己 readable 的 " +
      "window_methods **各自实现** resize 设 compressLevel（允许重复、无共享默认实现）；未声明的 class 无 resize（no default）。" +
      "读出侧 xml.ts:projectByCompressLevel 按 win.compressLevel 投影详略（0 全文 / 1 缩略 / 2 仅句柄）。",
    run: async () => {
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const { projectByCompressLevel } = await import("@ooc/builtins/agent/thread/thinkable/context/renderers/xml");
      const { xmlElement, xmlText, serializeXml } = await import("@ooc/core/_shared/types/xml");

      // 内容窗 class 各自实现的 resize（compress v2：无共享默认实现；这里模拟某内容窗自实现一份）。
      const selfResize = {
        name: "resize",
        description: "调本窗展示档位 level：0=全文 / 1=缩略 / 2=仅句柄。",
        schema: { args: { level: { type: "number", required: true, enum: [0, 1, 2] } } },
        exec: (_c: never, _s: unknown, before: { compressLevel?: number }, args: { level?: number }) => ({
          ...before,
          compressLevel: Math.max(0, Math.min(2, typeof args?.level === "number" ? args.level : 0)),
        }),
      };

      // no default：未声明 resize/compress 的 class → resolveWindowMethod 返 undefined（无通用回退）。
      const reg = createObjectRegistry();
      reg.register("plain_win", { executable: { methods: [] } } as never, { parentClass: null });
      check(reg.resolveWindowMethod("plain_win", "resize") === undefined, "no default：未声明 class 不应有 resize");
      check(reg.resolveWindowMethod("plain_win", "compress") === undefined, "no default：未声明 class 不应有 compress");

      // class 各自实现 resize → 解析到；exec 设 compressLevel 档位。
      reg.register(
        "content_win",
        { readable: { readable: () => ({ class: "content_win", content: [] }), window: [{ class: "content_win", object_methods: [], window_methods: [selfResize] }] } } as never,
        { parentClass: null },
      );
      const resize = reg.resolveWindowMethod("content_win", "resize");
      check(!!resize, "content_win 声明的 resize 未解析");
      const set2 = (await resize!.exec({} as never, makeReadonlySelfProxy({}), { compressLevel: 0 } as never, { level: 2 } as never)) as { compressLevel: number };
      check(set2.compressLevel === 2, `resize(level=2) 应设 compressLevel=2，得 ${set2.compressLevel}`);

      // 读出侧：level 0 原样、level 2 仅句柄 → 显著变短。
      const long = [xmlElement("readable", {}, [xmlText("x".repeat(500))])];
      const full = serializeXml(xmlElement("window", {}, projectByCompressLevel(long, 0)));
      const folded = serializeXml(xmlElement("window", {}, projectByCompressLevel(long, 2)));
      check(full.includes("x".repeat(500)), "level 0 应原样含全文");
      check(folded.length < full.length && !folded.includes("x".repeat(500)), "level 2 应折为句柄、显著变短");
    },
  }),

  story({
    id: "L2-COMPRESS-V2",
    layer: "thinkable",
    expectation:
      "compress v2 协议（thread 窗）：compress 无参意图置 compressIntent / resize 设 autoCompressLevel；阈值判定 transcript-gated；读出侧 projectSummarizedRanges 折叠",
    design:
      "compress v2：thread class 自声明 compress（无参→置 win.compressIntent，框架 fork summarizer 折早期历史、摘要由 fork 生成）" +
      "+ resize（设 win.autoCompressLevel 自动压缩档位）。compress-trigger.ts:autoCompressThreshold/shouldAutoCompress 据档位 + " +
      "未总结 transcript token 判定触发（transcript-gated H3）。harvest 记 win.summarizedRanges；读出侧 projectSummarizedRanges 投影。",
    run: async () => {
      await import("@ooc/core/runtime/register-builtins.js");
      const { builtinRegistry } = await import("@ooc/core/runtime/object-registry");
      const { THREAD_CLASS_ID } = await import("@ooc/core/_shared/types/constants");
      const { autoCompressThreshold, shouldAutoCompress } = await import("@ooc/builtins/agent/thread/thinkable/context/compress-trigger");
      const { projectSummarizedRanges } = await import("@ooc/core/_shared/utils/summarized-ranges");

      // thread class 自声明 compress（intent）+ resize（autoCompressLevel）——无通用默认表。
      const compress = builtinRegistry.resolveWindowMethod(THREAD_CLASS_ID, "compress");
      const resize = builtinRegistry.resolveWindowMethod(THREAD_CLASS_ID, "resize");
      check(!!compress && !!resize, "thread class 未声明 compress/resize（v2 协议缺失）");

      // compress 无参 → 置 compressIntent；resize(level=2) → 设 autoCompressLevel。
      const ci = (await compress!.exec({} as never, makeReadonlySelfProxy({}), {} as never, {} as never)) as { compressIntent?: boolean };
      check(ci.compressIntent === true, "compress 应置 compressIntent=true");
      const rl = (await resize!.exec({} as never, makeReadonlySelfProxy({}), {} as never, { level: 2 } as never)) as { autoCompressLevel?: number };
      check(rl.autoCompressLevel === 2, `resize(level=2) 应设 autoCompressLevel=2，得 ${rl.autoCompressLevel}`);

      // 触发判定（transcript-gated）：档位→阈值（2=soft/2 / 1=soft / 0=hard）；超阈值/intent 触发、在途不触发。
      const T = { soft: 100000, hard: 180000 };
      check(
        autoCompressThreshold(2, T) === 50000 && autoCompressThreshold(1, T) === 100000 && autoCompressThreshold(0, T) === 180000,
        "autoCompressThreshold 档位映射错",
      );
      check(shouldAutoCompress({ transcriptTokens: 60000, autoCompressLevel: 2, compressIntent: false, inFlight: false, thresholds: T }), "超档位阈值应触发");
      check(!shouldAutoCompress({ transcriptTokens: 999999, autoCompressLevel: 2, compressIntent: true, inFlight: true, thresholds: T }), "在途 compress 不应再触发");

      // 读出侧投影（载体不变）：6 项折 [1..3] → 4 项 + summary 替换段内、段外原样。
      const projected = projectSummarizedRanges(
        ["a", "b", "c", "d", "e", "f"],
        [{ fromIdx: 1, toIdx: 3, summary: "折叠 bcd" }],
        (s: string) => [`item:${s}`],
        (r: { summary: string }, n: number) => [`SUMMARY(${n}):${r.summary}`],
      );
      check(
        projected.length === 4 && projected.includes("SUMMARY(3):折叠 bcd") && !projected.includes("item:b") && projected.includes("item:e"),
        `折 [1..3] 应 6→4、summary 替换段内段外原样：${JSON.stringify(projected)}`,
      );
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
