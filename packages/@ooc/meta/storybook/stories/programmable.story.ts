/**
 * Story: programmable —— Object 自定义方法（executable）。
 *
 * 能力：Object 通过 executable/index.ts 定义自定义方法，经 HTTP 被外部调用，方法执行时拿到
 * 自己的 stone 目录（ctx.self.dir）；改源码后热更新立即生效。规格见 specs/capability_programmable.md。
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { mkServer, postJson, writeStoneFile, StoryRecorder } from "../_harness/control-plane";
import { seedTask, waitJob, processTrace, req } from "../_harness/agent-native";
import { rollupTier, type StoryResult } from "../_harness/types";

const EXEC = (body: string) => `${body}\nexport const window = { methods: {} };`;
/** dev hot-reload（fs.watch）失效有 debounce —— 改 executable 源码后等其生效再调用。 */
const HOT = 350;

export async function runControlPlane(): Promise<StoryResult> {
  const rec = new StoryRecorder();
  const srv = await mkServer();
  const { app, baseDir } = srv;
  try {
    // TC-PROG-01: 定义 ui_methods 并经 HTTP 调用
    {
      const id = "echo_agent";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        EXEC(`export const ui_methods = { echo: { fn: (ctx, args) => ({ youSaid: args.text }) } };`));
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "echo", args: { text: "hello" } });
      rec.eq("TC-PROG-01", "ui_methods 经 HTTP 调用返回正确值", r.json?.returnValue, { youSaid: "hello" });
    }

    // TC-PROG-02: 方法拿到 ctx.self.dir 且目录真实存在
    {
      const id = "dir_checker";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        EXEC(`export const ui_methods = { getMyDir: { fn: (ctx) => ({ myDir: ctx.self.dir }) } };`));
      const r = await postJson(app, `/api/stones/${id}/call_method`, { method: "getMyDir" });
      const myDir: string = r.json?.returnValue?.myDir ?? "";
      const endsOk = myDir.endsWith(join("stones", "main", "objects", id));
      const exists = (() => { try { return statSync(myDir).isDirectory(); } catch { return false; } })();
      rec.ok("TC-PROG-02", "方法拿到 ctx.self.dir（自己的 stone 路径）且目录真实存在",
        endsOk && exists, `myDir=${myDir}, endsOk=${endsOk}, exists=${exists}`);
    }

    // TC-PROG-03: window.commands 可经 loadObjectWindow 加载（LLM 路径自定义命令）
    {
      const id = "cmd_demo";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts",
        `export const window = { methods: { greet: { paths: ["greet"], intent: () => [], exec: async () => ({ reply: "hi" }) } } };\nexport const ui_methods = {};`);
      const { loadObjectWindow } = await import("@ooc/core/runtime/server-loader");
      const win = await loadObjectWindow({ baseDir, objectId: id });
      const ok = !!win?.methods?.greet && JSON.stringify(win?.methods?.greet?.paths) === JSON.stringify(["greet"]);
      rec.ok("TC-PROG-03", "window.commands（LLM 路径自定义命令）经 loader 加载", ok,
        `hasGreet=${!!win?.methods?.greet}, paths=${JSON.stringify(win?.methods?.greet?.paths)}`);
    }

    // TC-PROG-04: 热更新 —— 改 executable 后已有方法变更 + 新增方法立即生效
    {
      const id = "hot_prog";
      await postJson(app, "/api/stones", { objectId: id });
      writeStoneFile(baseDir, id, "executable/index.ts", EXEC(`export const ui_methods = { ping: { fn: () => "v1" } };`));
      await sleep(HOT);
      const r1 = await postJson(app, `/api/stones/${id}/call_method`, { method: "ping" });
      writeStoneFile(baseDir, id, "executable/index.ts",
        EXEC(`export const ui_methods = { ping: { fn: () => "v2" }, pong: { fn: () => "pong" } };`));
      await sleep(HOT);
      const r2 = await postJson(app, `/api/stones/${id}/call_method`, { method: "ping" });
      const r3 = await postJson(app, `/api/stones/${id}/call_method`, { method: "pong" });
      const ok = r1.json?.returnValue === "v1" && r2.json?.returnValue === "v2" && r3.json?.returnValue === "pong";
      rec.ok("TC-PROG-04", "热更新：改 executable 后已有方法变更、新增方法立即生效", ok,
        `ping(v1)=${r1.json?.returnValue}, ping(v2)=${r2.json?.returnValue}, pong=${r3.json?.returnValue}`);
    }
  } finally {
    await srv.cleanup();
  }
  return { capability: "programmable", tier: "control-plane", tcs: rec.tcs, storyTier: rollupTier(rec.tcs) };
}

/**
 * Tier B —— agent-native：supervisor 在 thinkloop 里用 metaprog 亲手创建一个带身份+知识的对象。
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
  if (seed.ok && seed.threadId) {
    await waitJob(seed.jobId!);
    trace = await processTrace(sid, "supervisor", seed.threadId);
    const created = await req("GET", `/api/stones/${id}`);
    const self = await req("GET", `/api/stones/${id}/self`);
    verified = created.status === 200 && (self.json?.text ?? "").length > 20;
    detail = verified ? `${id} 已由 supervisor 亲手创建，self.md ${self.json.text.length} 字符` : `getStone=${created.status}, self.len=${(self.json?.text ?? "").length}`;
  }
  const tcs = [{ id: "AN-PROG-01", name: "supervisor 经 metaprog 亲手创建带身份+知识的对象", status: verified ? "PASS" as const : "FAIL" as const, detail }];
  return { capability: "programmable", tier: "agent-native", tcs, storyTier: rollupTier(tcs), trace };
}
