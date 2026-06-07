/**
 * Tier B（agent-native）共享 harness。
 *
 * 对一个**运行中的 OOC world**（OOC_BACKEND，默认 :3000，需含 supervisor —— 即真 `index.ts` 全启动
 * world）派演示任务，让 agent 在 thinkloop 里亲手行使能力，抽**过程轨迹** + 确定性产物核验。
 * 抽自 _demo_session.ts。需真 LLM 凭证；由 runner 在 RUN_STORYBOOK_AGENT=1 时调用。
 */
import { setTimeout as sleep } from "node:timers/promises";

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

/** 从某 thread 的事件抽「执行过程轨迹」——agent 的可见动作。 */
export async function processTrace(sessionId: string, objectId: string, threadId: string): Promise<string[]> {
  const r = await req("GET", `/api/flows/${sessionId}/${objectId}/threads/${threadId}`);
  const events: any[] = r.json?.events ?? [];
  const lines: string[] = [];
  for (const e of events) {
    if (e.kind === "call_started") lines.push(`  · 思考一轮（loop ${e.loopIndex}）`);
    else if (e.kind === "function_call" && e.toolName === "exec") {
      const cmd = e.arguments?.command;
      const a = e.arguments?.args ?? {};
      if ("msg" in a) lines.push(`  → exec say：「${String(a.msg).replace(/\s+/g, " ").slice(0, 100)}」`);
      else if (cmd === "metaprog") lines.push(`  → exec metaprog action=${a.action} ${a.objectId ?? a.name ?? ""}`);
      else if (cmd === "talk") lines.push(`  → exec talk target=${a.target ?? a.objectId ?? ""}`);
      else lines.push(`  → exec ${cmd}`);
    }
  }
  return lines;
}
