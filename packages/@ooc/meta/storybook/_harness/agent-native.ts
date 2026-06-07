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

/** 读某 thread 的 exec 事件（command + args + say 文本）。 */
export async function threadExecs(sessionId: string, objectId: string, threadId: string): Promise<Array<{ cmd: string; args: any; msg?: string }>> {
  const r = await req("GET", `/api/flows/${sessionId}/${objectId}/threads/${threadId}`);
  const out: Array<{ cmd: string; args: any; msg?: string }> = [];
  for (const e of (r.json?.events ?? [])) {
    if (e.kind === "function_call" && e.toolName === "exec") {
      const a = e.arguments?.args ?? {};
      out.push({ cmd: e.arguments?.command ?? "", args: a, msg: typeof a.msg === "string" ? a.msg : undefined });
    }
  }
  return out;
}

/** 从 exec 事件渲染人类可读过程轨迹。 */
export function renderTrace(execs: Array<{ cmd: string; args: any; msg?: string }>): string[] {
  return execs.map((e) => {
    if (e.msg) return `  → exec say：「${e.msg.replace(/\s+/g, " ").slice(0, 100)}」`;
    if (e.cmd === "metaprog") return `  → exec metaprog action=${e.args?.action} ${e.args?.objectId ?? e.args?.name ?? ""}`;
    if (e.cmd === "talk") return `  → exec talk target=${e.args?.target ?? e.args?.objectId ?? ""}`;
    return `  → exec ${e.cmd}`;
  });
}

/** 从某 thread 抽过程轨迹（兼容旧调用）。 */
export async function processTrace(sessionId: string, objectId: string, threadId: string): Promise<string[]> {
  return renderTrace(await threadExecs(sessionId, objectId, threadId));
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
