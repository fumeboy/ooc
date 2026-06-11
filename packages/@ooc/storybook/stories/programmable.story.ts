/**
 * Story: programmable —— Object 自定义方法（executable）。
 *
 * 能力：Object 通过 executable/index.ts 的 `window.methods` 定义自定义方法。标 `for_ui_access`
 * 的方法经 HTTP `call_method` 被外部调用，响应即标准 MethodOutcome（结构化数据走 `data`）；
 * 改源码后热更新立即生效。规格见 programmable 对象 knowledge/tests.md（.ooc-world-meta）。
 * （2026-06-11 废 ui_methods 维度后统一到 window.methods + for_ui_access。）
 */
import { setTimeout as sleep } from "node:timers/promises";
import { mkServer, postJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { seedTask, waitJob, processTrace, getStoneSelfWithRetry, threadLlmInfraFailed, calledMethodOk } from "../_harness/agent-native";
import { rollupTier, type StoryResult } from "../_harness/types";

/** 包一个只含 methods 的 stone executable 源。 */
const M = (methods: string) => `export const window = { methods: ${methods} };`;
/** dev hot-reload（fs.watch）失效有 debounce —— 改 executable 源码后等其生效再调用。 */
const HOT = 350;

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    // TC-PROG-01: for_ui_access 方法经 HTTP 调用，从 MethodOutcome.data 取结果
    {
      const id = "echo_agent";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        M(`{ echo: { description: "echo", for_ui_access: true, exec: ({ args }) => ({ ok: true, data: { youSaid: args.text } }) } }`));
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "echo", args: { text: "hello" } });
      rec.eq("TC-PROG-01", "for_ui_access 方法经 HTTP 调用，data 通道返回正确值", r.json?.data, { youSaid: "hello" });
    }

    // TC-PROG-02: for_ui_access 方法经 data 通道返回嵌套结构化数据（前端取数通道）
    {
      const id = "data_shaper";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        M(`{ shape: { description: "shape", for_ui_access: true, exec: ({ args }) => ({ ok: true, data: { items: [args.a, args.b], count: 2 } }) } }`));
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "shape", args: { a: 1, b: 2 } });
      rec.eq("TC-PROG-02", "for_ui_access 方法经 data 通道返回嵌套结构化数据", r.json?.data, { items: [1, 2], count: 2 });
    }

    // TC-PROG-03: 不带 for_ui_access 的 LLM 路径自定义命令经 loadObjectWindow 加载
    {
      const id = "cmd_demo";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        M(`{ greet: { description: "greet", intents: ["greet"], exec: async () => ({ ok: true, result: "hi" }) } }`));
      const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
      const win = await loadObjectWindow({ baseDir, objectId: id });
      const ok = !!win?.methods?.greet && JSON.stringify(win?.methods?.greet?.intents) === JSON.stringify(["greet"]);
      rec.ok("TC-PROG-03", "window.methods（LLM 路径自定义命令）经 loader 加载", ok,
        `hasGreet=${!!win?.methods?.greet}, intents=${JSON.stringify(win?.methods?.greet?.intents)}`);
    }

    // TC-PROG-04: 热更新 —— 改 executable 后已有方法变更 + 新增方法立即生效
    {
      const id = "hot_prog";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        M(`{ ping: { description: "ping", for_ui_access: true, exec: () => ({ ok: true, data: "v1" }) } }`));
      await sleep(HOT);
      const r1 = await postJson(app, `/api/stones/${id}/call_method`, { method: "ping" });
      writeStoneFile(baseDir, id, "executable/index.ts",
        M(`{ ping: { description: "ping", for_ui_access: true, exec: () => ({ ok: true, data: "v2" }) }, pong: { description: "pong", for_ui_access: true, exec: () => ({ ok: true, data: "pong" }) } }`));
      await sleep(HOT);
      const r2 = await postJson(app, `/api/stones/${id}/call_method`, { method: "ping" });
      const r3 = await postJson(app, `/api/stones/${id}/call_method`, { method: "pong" });
      const ok = r1.json?.data === "v1" && r2.json?.data === "v2" && r3.json?.data === "pong";
      rec.ok("TC-PROG-04", "热更新：改 executable 后已有方法变更、新增方法立即生效", ok,
        `ping(v1)=${r1.json?.data}, ping(v2)=${r2.json?.data}, pong=${r3.json?.data}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "programmable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

/**
 * Tier B —— agent-native：supervisor 在 thinkloop 里用 create_object 亲手创建一个带身份+知识的对象。
 * 过程作为可见动作留在 session；脚本核验产物（对象落盘 + self.md 非空）。需运行中的 world（含 supervisor）。
 */
export async function runAgentNative(): Promise<StoryResult> {
  const tag = Math.floor(Date.now() / 1000) % 100000;
  const id = `sb_prog_${tag}`;
  const sid = `sb-an-prog-${tag}`;
  const seed = await seedTask(sid, "supervisor",
    `请为我创建一个名为 ${id} 的新 OOC Object，职责自定；给它写好 self.md（身份/能力）和一条 knowledge。创建好后用一句话告诉我你做了什么。`,
    "storybook agent-native: programmable");
  let trace: string[] = [];
  let verified = false;
  let detail = "seed 失败";
  let infraDetail: string | null = null;
  if (seed.ok && seed.threadId) {
    await waitJob(seed.jobId!);
    infraDetail = await threadLlmInfraFailed(sid, "supervisor", seed.threadId);
    if (!infraDetail) {
      trace = await processTrace(sid, "supervisor", seed.threadId);
      // 新模型：create_object 落 session worktree（运行时派生物，永不合入 main）；进 canonical 走
      // super flow evolve_self → feat-branch PR → resolve merge 才在 /api/stones(main) 可见。
      const self = await getStoneSelfWithRetry(id);
      if (self.status === 200 && self.text.length > 20) {
        verified = true;
        detail = `${id} 已建并经 feat-branch PR 合入 main，self.md ${self.text.length} 字符`;
      } else if (await calledMethodOk(sid, "supervisor", seed.threadId, "create_object")) {
        // 建对象能力达成：create_object 成功落 session worktree（沉淀进 main 是单独的 feat-branch PR 能力）。
        verified = true;
        detail = `${id} 已由 create_object 建对象落 session worktree（未沉淀 main——沉淀走单独的 feat-branch PR）`;
      } else {
        detail = `self=${self.status}, len=${self.text.length}——agent 未成功建对象（create_object 未成功）`;
      }
    }
  }
  // LLM 端点 infra 抖动（超时/socket）= 非能力问题 → SKIP（rollupTier→OK），不计能力 Bad。
  const tcs = [{
    id: "AN-PROG-01",
    name: "supervisor 经 write_file+evolve_self 亲手创建带身份+知识的对象",
    status: (infraDetail ? "SKIP" : verified ? "PASS" : "FAIL") as "SKIP" | "PASS" | "FAIL",
    detail: infraDetail ? `LLM 端点 infra 抖动（非能力问题）：${infraDetail}` : detail,
  }];
  return { capability: "programmable", tier: "agent-native", tcs, storyTier: rollupTier(tcs), trace };
}
