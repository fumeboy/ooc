/**
 * Tier B（agent-native）共享 harness。
 *
 * 对一个**运行中的 OOC world**（OOC_BACKEND，默认 :3000，需含 supervisor —— 即真 `index.ts` 全启动
 * world）派演示任务，让 agent 在 thinkloop 里亲手行使能力，抽**过程轨迹** + 确定性产物核验。
 * 抽自 _demo_session.ts。需真 LLM 凭证；由 runner 在 RUN_STORYBOOK_AGENT=1 时调用。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { rollupTier, type CapabilityId, type StoryResult, type TcResult } from "./types";

export const BACKEND = process.env.OOC_BACKEND ?? "http://localhost:3000";

export async function req(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const init: RequestInit = { method, headers: new Headers() };
  if (body !== undefined) {
    (init.headers as Headers).set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const r = await fetch(BACKEND + path, init);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text), text }; } catch { return { status: r.status, json: undefined, text }; }
}

/** world 是否可达（runner 据此决定 Tier B 跑还是 SKIP）。 */
export async function backendReachable(): Promise<boolean> {
  try { return (await fetch(`${BACKEND}/api/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

/** 轮询 job 至 done/failed（或超时）。真 LLM 慢，别跳。 */
export async function waitJob(jobId: string, timeoutMs = 90_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await req("GET", `/api/runtime/jobs/${jobId}`);
    const s = r.json?.status;
    if (s === "done" || s === "failed") return s;
    await sleep(1500);
  }
  return "timeout";
}

/** seed 一个对 target 的 session，返回 {sessionId, threadId, jobId}。 */
export async function seedTask(sessionId: string, target: string, message: string, title?: string) {
  const r = await req("POST", "/api/sessions", { sessionId, targetObjectId: target, initialMessage: message, title });
  return { ok: r.status === 200, sessionId, threadId: r.json?.targetThreadId as string | undefined, jobId: r.json?.jobId as string | undefined, raw: r };
}

/** 在已有 session 上续派任务。 */
export async function continueTask(sessionId: string, text: string) {
  const r = await req("POST", `/api/flows/${sessionId}/continue`, { text });
  return { jobId: r.json?.jobId as string | undefined, raw: r };
}

/** 读某 thread 的 exec 事件（method + args + say 文本）。 */
export async function threadExecs(sessionId: string, objectId: string, threadId: string): Promise<Array<{ cmd: string; args: any; msg?: string }>> {
  const r = await req("GET", `/api/flows/${sessionId}/${objectId}/threads/${threadId}`);
  const out: Array<{ cmd: string; args: any; msg?: string }> = [];
  for (const e of (r.json?.events ?? [])) {
    if (e.kind === "function_call" && e.toolName === "exec") {
      const a = e.arguments?.args ?? {};
      out.push({ cmd: e.arguments?.method ?? "", args: a, msg: typeof a.msg === "string" ? a.msg : undefined });
    }
  }
  return out;
}

/** 从 exec 事件渲染人类可读过程轨迹。 */
export function renderTrace(execs: Array<{ cmd: string; args: any; msg?: string }>): string[] {
  return execs.map((e) => {
    if (e.msg) return `  → exec say：「${e.msg.replace(/\s+/g, " ").slice(0, 100)}」`;
    if (e.cmd === "talk") return `  → exec talk target=${e.args?.target ?? e.args?.objectId ?? ""}`;
    return `  → exec ${e.cmd}`;
  });
}

/** 从某 thread 抽过程轨迹（兼容旧调用）。 */
export async function processTrace(sessionId: string, objectId: string, threadId: string): Promise<string[]> {
  return renderTrace(await threadExecs(sessionId, objectId, threadId));
}

/**
 * 检测 supervisor thread 是否因 **LLM 传输层错误**（调用超时 / socket 断 / 连接关闭）而 failed。
 * 这类属 LLM 端点 infra 抖动、**非能力问题**——caller 应把它标 SKIP（rollupTier→OK）而非 Bad，
 * 避免端点抖动污染能力回归矩阵。命中返回简短错误文本，否则 null。
 */
export async function threadLlmInfraFailed(sid: string, objectId: string, threadId: string): Promise<string | null> {
  const r = await req("GET", `/api/flows/${sid}/${objectId}/threads/${threadId}`);
  if (r.json?.status !== "failed") return null;
  for (const e of (r.json?.events ?? [])) {
    const text = String(e.text ?? e.message ?? "");
    if (/超时|socket|connection (was )?closed|timeout|ECONNRESET|ETIMEDOUT|unexpectedly/i.test(text)) {
      return text.replace(/\s+/g, " ").slice(0, 120);
    }
  }
  return null;
}

/**
 * GET 一个 stone 的 self.md，带重试。
 *
 * 新模型（去 metaprog）下建对象 = 业务 session write_file 落 session worktree → super flow evolve_self
 * 合入 main 才在 /api/stones 可见（有延迟，且 evolve 是发起 job 之后的独立 super flow job）。建对象类
 * 判据若 seed-job done 后立即 GET main 会假阴性。本 helper 重试等待 evolve 合入完成。
 * 仍 404 = 对象确实没合入 main（agent 没建/没 evolve，真问题）。
 */
export async function getStoneSelfWithRetry(
  objectId: string,
  opts: { tries?: number; delayMs?: number } = {},
): Promise<{ status: number; text: string }> {
  const tries = opts.tries ?? 8;
  const delayMs = opts.delayMs ?? 2000;
  let last = { status: 0, text: "" };
  for (let i = 0; i < tries; i++) {
    const r = await req("GET", `/api/stones/${objectId}/self`);
    last = { status: r.status, text: r.json?.text ?? "" };
    if (last.status === 200 && last.text.length > 0) return last;
    await sleep(delayMs);
  }
  return last;
}

/**
 * 检查某 thread 是否**成功**调用了指定 method（exec method=<method> 后紧跟的
 * function_call_output result 含 ok:true）。
 *
 * 用于建对象类判据：新模型（去 metaprog）下 create_object 落 session worktree、**不立即合入 main**
 * （需 super flow evolve_self），supervisor 常建完即 end 不 evolve → GET /api/stones/<id>(main) 404。
 * 「建对象能力达成」的正确判据 = create_object 成功（对象落 worktree），而非「已 evolve 合入 main」
 * （后者是单独的 persistable/reflectable 合入能力）。
 */
export async function calledMethodOk(sid: string, objectId: string, threadId: string, method: string): Promise<boolean> {
  const r = await req("GET", `/api/flows/${sid}/${objectId}/threads/${threadId}`);
  const events = (r.json?.events ?? []) as Array<{ kind?: string; toolName?: string; arguments?: any; output?: unknown }>;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "function_call" && e.toolName === "exec" && e.arguments?.method === method) {
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].kind === "function_call_output") {
          if (/"ok"\s*:\s*true/.test(String(events[j].output ?? ""))) return true;
          break; // 紧邻的 output 非 ok → 该次调用失败，继续找下一次同名调用
        }
      }
    }
  }
  return false;
}

export type VerifyCtx = { sid: string; threadId: string; execs: Array<{ cmd: string; args: any; msg?: string }>; lastSay: string };

/**
 * Tier B 通用编排：对 supervisor 派任务 → 等 job → 抽过程轨迹 → 跑 verify。
 * verify 返回 {ok, detail}；过程作为可见动作留在 session。world 不可达 / seed 失败 → Bad。
 */
export async function demoViaSupervisor(
  capability: CapabilityId,
  sid: string,
  message: string,
  verify: (ctx: VerifyCtx) => Promise<{ ok: boolean; detail: string }>,
  opts: { title?: string } = {},
): Promise<StoryResult> {
  const seed = await seedTask(sid, "supervisor", message, opts.title ?? `storybook agent-native: ${capability}`);
  if (!seed.ok || !seed.threadId) {
    const tcs: TcResult[] = [{ id: `AN-${capability}`, name: capability, status: "FAIL", detail: `seed 失败 status=${seed.raw.status}` }];
    return { capability, tier: "agent-native", tcs, storyTier: "Bad", trace: [] };
  }
  await waitJob(seed.jobId!);
  // LLM 传输层失败（调用超时 / socket 断）= 端点 infra 抖动，非能力问题 → 标 SKIP（rollupTier→OK），
  // 不让端点抖动污染能力回归矩阵（区分「能力坏」与「环境噪音」）。
  const infra = await threadLlmInfraFailed(sid, "supervisor", seed.threadId);
  if (infra) {
    const tcs: TcResult[] = [
      { id: `AN-${capability}`, name: capability, status: "SKIP", detail: `LLM 端点 infra 抖动（非能力问题）：${infra}` },
    ];
    return { capability, tier: "agent-native", tcs, storyTier: rollupTier(tcs), trace: [] };
  }
  const execs = await threadExecs(sid, "supervisor", seed.threadId);
  const lastSay = [...execs].reverse().find((e) => e.msg)?.msg ?? "";
  const v = await verify({ sid, threadId: seed.threadId, execs, lastSay });
  const tcs: TcResult[] = [{ id: `AN-${capability}-01`, name: capability, status: v.ok ? "PASS" : "FAIL", detail: v.detail }];
  return { capability, tier: "agent-native", tcs, storyTier: rollupTier(tcs), trace: renderTrace(execs) };
}

/** 某 session 下 objectId 的 callee thread 是否出现了 say（被激活并回应）。轮询。 */
export async function calleeReplied(sid: string, objectId: string, maxTries = 20): Promise<boolean> {
  for (let i = 0; i < maxTries; i++) {
    const threads = await req("GET", `/api/flows/${sid}/threads`);
    const ct = (threads.json?.items ?? []).find((t: any) => t.objectId === objectId);
    if (ct) {
      const execs = await threadExecs(sid, objectId, ct.threadId);
      if (execs.some((e) => e.cmd === "say")) return true;
    }
    await sleep(2000);
  }
  return false;
}
