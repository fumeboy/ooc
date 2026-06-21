/**
 * Story: executable —— LLM 经稳定 tool 原语在 ContextWindow 上调 Method 改变世界。
 *
 * 控制面（无 LLM）只验**结构**：① Object 自定义 visible/server 方法经 HTTP call_method 执行（人类侧）；
 * ② Object 定义的 executable.methods（LLM 命令面）经 loadStoneClass 可加载；③ 填表式渐进执行——method
 * 声明 route 时 exec 缺参开 method_exec form、refine 累积、submit 提交（route 只在 exec 工具边界消费，
 * 确定性可验）。深度（3 原语 exec/close/wait 驱动真实编辑）属 Tier B + e2e S1/S2。
 * 规格见 executable 对象 knowledge/tests.md（.ooc-world-meta）。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { createFlowSession, createFlowObject } from "@ooc/core/persistable";
import { mkServer, postJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { rollupTier, type StoryResult } from "../_harness/types";

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    // TC-EXEC-01: visible/server 方法经 HTTP call_method 执行（结果走 data 通道；人类侧 UI）。
    // Wave4 对象模型：stone 一处 `export const Class: OocClass`（root index.ts），visibleServer.methods
    // 是数组，exec 三参 (ctx, self, args)；call_method 经 registry.resolveVisibleServer 取方法。
    {
      const id = "calc";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         export const Class: OocClass = { visibleServer: { methods: [
           { name: "add", description: "add",
             exec: (_ctx, _self, args) => ({ data: { sum: args.x + args.y } }) },
         ] } };`);
      await sleep(350);
      // call_method 走 flow scope（stone scope 不调 object 程序——运行时/data 编辑归 flow session）。
      const sid = "exec-calc";
      await createFlowSession(baseDir, sid);
      await createFlowObject({ baseDir, sessionId: sid, objectId: id });
      const r = await postJson(app, `/api/flows/${sid}/${id}/call_method`, { method: "add", args: { x: 2, y: 3 } });
      rec.eq("TC-EXEC-01", "visible/server 方法经 HTTP 执行并 data 通道返回结果", r.json?.data, { sum: 5 });
    }

    // TC-EXEC-02: object method（LLM 命令面）经 loadStoneClass 可加载（executable 维度）。
    // 退役 loadObjectWindow（barrel `export const window`）→ loadStoneClass 读 root index.ts 的 Class。
    {
      const id = "cmd_obj";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         export const Class: OocClass = { executable: { methods: [
           { name: "run", description: "run", exec: async () => ({ message: "ok" }) },
         ] } };`);
      const { loadStoneClass } = await import("@ooc/core/runtime/server-loader");
      const loaded = await loadStoneClass({ baseDir, objectId: id });
      const names = (loaded?.cls?.executable?.methods ?? []).map((m) => m.name);
      rec.ok("TC-EXEC-02", "object method（LLM 命令面）经 loadStoneClass 可加载",
        names.includes("run"),
        `methods=${JSON.stringify(names)}`);
    }

    // TC-EXEC-03: 填表式渐进执行 form lifecycle（确定性，无 LLM）。method 声明 route → exec 缺参不直执行、
    // 开 method_exec form（带 refine/submit）；refine 累积参数；submit 用累积参数执行 + form 释放。
    {
      const id = "rec_cp";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "index.ts",
        `import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
         import type { ObjectMethod } from "@ooc/core/executable/contract.js";
         const CreateOrUpdate: ObjectMethod = {
           name: "CreateOrUpdate", description: "create or update record",
           schema: { args: { content: { type: "string", required: true, description: "c" }, id: { type: "string", required: false, description: "id" } } },
           intents: [{ name: "create", description: "c" }, { name: "update", description: "u" }],
           route: (_c, _s, a) => a.content ? { intents: [a.id ? "update" : "create"] } : { tip: "需要补充 content", intents: [] },
           exec: async (ctx, self, a) => { const d = self; d.records = d.records ?? []; if (!a.content) return { err: "empty" }; d.records.push({ content: a.content }); await ctx.reportDataEdit?.(); return "record created (" + d.records.length + ")"; },
         };
         export const Class: OocClass = { executable: { methods: [CreateOrUpdate] } };`);
      await sleep(350);
      const { handleExecTool } = await import("@ooc/core/executable/tools/exec");
      const { createObjectRegistry } = await import("@ooc/core/runtime/object-registry");
      const { defaultServerLoader } = await import("@ooc/core/runtime/server-loader");
      const reg = createObjectRegistry();
      await defaultServerLoader.loadAndRegisterStoneClass({ baseDir, objectId: id }, id, reg);
      const thread: any = {
        id: "t_cp", status: "running", events: [],
        contextWindows: [{ id, title: id, status: "open", createdAt: 0, object: { class: id, data: {} } }],
      };
      const out1 = await handleExecTool(thread, { window_id: id, method: "CreateOrUpdate", title: "建", args: {} }, reg);
      const form = thread.contextWindows.find((w: any) => w.object.class === "method_exec");
      rec.ok("TC-EXEC-03a", "route 缺参 → 开 method_exec form（不直执行）+ tip 回显",
        !!form && out1.includes("需要补充 content"), `out=${out1.slice(0, 90)}`);
      if (form) {
        await handleExecTool(thread, { window_id: form.id, method: "refine", title: "补", args: { content: "hi" } }, reg);
        const subOut = await handleExecTool(thread, { window_id: form.id, method: "submit", title: "提交" }, reg);
        const gone = !thread.contextWindows.find((w: any) => w.id === form.id);
        rec.ok("TC-EXEC-03b", "refine 累积 + submit 用累积参数建记录 + form 释放",
          subOut.includes("record created") && gone, `sub=${subOut.slice(0, 90)} formGone=${gone}`);
      }
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "executable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

import { demoViaSupervisor } from "../_harness/agent-native";
import { rollupTier as _rollupTier } from "../_harness/types";

/**
 * Tier B —— agent-native（真 LLM，env-gated）：两个场景合并。
 * ① supervisor 用工具原语（glob/run 等）真实行动。
 * ② 填表式渐进执行：record_demo 自主用其 route'd object method `CreateOrUpdate`——开 form → submit
 *    → 建记录（prompt 不点名方法，验自有方法可发现 + form 链路真 LLM 走通）。
 *    依赖永久 fixture `record_demo`（.ooc-world stone 仓）。
 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;

  const toolUse = await demoViaSupervisor("executable", `sb-an-exec-${tag}`,
    "请用一个工具（glob 或 terminal.run 都行）看看当前仓库根目录下有哪些 .md 文件，然后告诉我结果。",
    async ({ execs }) => {
      const tools = execs.map((e) => e.cmd).filter((c) => ["glob", "grep", "run", "open_file", "talk"].includes(c));
      return { ok: tools.length > 0, detail: `用到的 tool 原语：${JSON.stringify([...new Set(tools)])}` };
    });

  const form = await demoViaSupervisor("executable", `sb-an-form-${tag}`,
    "帮我记一笔：『storybook 渐进填表验证』。存成一条新记录。",
    async ({ execs }) => {
      const cmds = execs.map((e) => e.cmd);
      const opened = cmds.includes("CreateOrUpdate"); // route → 开 form
      const submitted = cmds.includes("submit"); // 提交 form
      return { ok: opened && submitted, detail: `CreateOrUpdate=${opened} submit=${submitted} execs=${JSON.stringify(cmds)}` };
    },
    { target: "record_demo" });

  // 合并两场景：TC 各自命名，story 级三档由合并集汇总。
  const tcs = [
    ...toolUse.tcs.map((t) => ({ ...t, id: `${t.id}-toolprim` })),
    ...form.tcs.map((t) => ({ ...t, id: `${t.id}-form` })),
  ];
  return {
    capability: "executable",
    tier: "agent-native",
    tcs,
    storyTier: _rollupTier(tcs),
    trace: [...(toolUse.trace ?? []), "── form ──", ...(form.trace ?? [])],
  };
}
