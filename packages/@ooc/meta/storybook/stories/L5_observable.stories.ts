/**
 * L5 — Observable（debug / activity / pause）。
 * 过程可观测：debug 落盘 / pause / activity 快照。
 * 真正的 LLM 调用快照（llm.input/output.json、loop_<N>）需 worker → skip 归 Tier B。
 */
import { postJson, getJson } from "../_harness/control-plane";
import { story, check, skip, type Story } from "../_harness/story";

export const L5_STORIES: Story[] = [
  story({
    id: "L5-DEBUG-TOGGLE",
    layer: "observable",
    expectation: "debug enable 后 /api/runtime/debug/status 返回 enabled=true",
    design: "observable：debug 开关经 HTTP 可切换可查询。modules/runtime/api.enable-debug / get-debug-status",
    run: async ({ app }) => {
      await postJson(app, "/api/runtime/debug/enable");
      const r = await getJson(app, "/api/runtime/debug/status");
      check(r.json?.enabled === true, `debug status=${JSON.stringify(r.json)}`);
    },
  }),

  story({
    id: "L5-ACTIVITY",
    layer: "observable",
    expectation: "/api/runtime/activity 返回 now / runningCount / jobs 结构",
    design: "observable：运行时活动快照（诊断卡顿）。modules/runtime/api.activity.ts",
    run: async ({ app }) => {
      const r = await getJson(app, "/api/runtime/activity");
      check(r.status === 200, `status=${r.status}`);
      check(typeof r.json?.now !== "undefined" && Array.isArray(r.json?.jobs), `activity 结构异常：${JSON.stringify(Object.keys(r.json ?? {}))}`);
    },
  }),

  story({
    id: "L5-GLOBAL-PAUSE",
    layer: "observable",
    expectation: "global-pause enable→status enabled，disable→status disabled",
    design: "observable：全局暂停经 HTTP 可切换。modules/runtime/api.*-global-pause",
    run: async ({ app }) => {
      await postJson(app, "/api/runtime/global-pause/enable");
      let r = await getJson(app, "/api/runtime/global-pause/status");
      check(r.json?.enabled === true, `enable 后 status=${JSON.stringify(r.json)}`);
      await postJson(app, "/api/runtime/global-pause/disable");
      r = await getJson(app, "/api/runtime/global-pause/status");
      check(r.json?.enabled === false, `disable 后 status=${JSON.stringify(r.json)}`);
    },
  }),

  story({
    id: "L5-JOB-STATUS",
    layer: "observable",
    expectation: "发起 session 产生的 job 经 /api/runtime/jobs/:id 可查 status",
    design: "observable/app-server：runtime job 语义可查询。modules/runtime/api.get-job.ts",
    run: async ({ app }) => {
      await postJson(app, "/api/stones", { objectId: "obj_job", self: "# job" });
      const seed = await postJson(app, "/api/sessions", { sessionId: "sb-o-job", targetObjectId: "obj_job", initialMessage: "hi" });
      const jobId = seed.json?.jobId;
      check(!!jobId, "seed 未返回 jobId");
      const r = await getJson(app, `/api/runtime/jobs/${jobId}`);
      check(r.status === 200 && typeof r.json?.status === "string", `job 查询异常：${r.status} ${JSON.stringify(r.json)}`);
    },
  }),

  story({
    id: "L5-DEBUG-SNAPSHOT",
    layer: "observable",
    expectation: "跑一轮 thread 后 debug/llm.input.json + llm.output.json 落盘",
    design: "observable：每次 LLM 调用前后抽 context/输出快照。persistable/debug-file.ts。需 worker（Tier B）",
    run: async () => skip("LLM 调用快照需 worker 真跑 thinkloop，控制面无 LLM（Tier B）"),
  }),

  story({
    id: "L5-LOOP-DEBUG",
    layer: "observable",
    expectation: "多轮 loop 各自落 loop_<N>.{input,output,meta}.json",
    design: "observable：multi-turn loop 每轮独立快照。api.list-loop-debug。需 worker（Tier B）",
    run: async () => skip("loop 快照需 worker 多轮 thinkloop，控制面无 LLM（Tier B）"),
  }),
];
