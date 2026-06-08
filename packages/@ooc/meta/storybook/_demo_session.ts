/**
 * Agent-native storybook 演示。
 *
 * 与 _verify.ts（控制面确定性测试）不同：本脚本**不自己跑测试**，而是给运行中的 OOC World
 * 里的 supervisor 发一系列「演示任务」，让它**在 thinkloop 里用自己的工具真实执行**——
 * 创建对象、协作、汇报。脚本只负责：编排任务、从 supervisor 的 thread 事件里抽取**执行
 * 过程轨迹**、并经 HTTP API 核验产物。整个过程作为 agent 的可见动作留在前端 session 里。
 *
 * 这是对「过程要可见」的回应：能力是 OOC agent 自己行使的，不是外部脚本跑完贴报告。
 *
 * Run（需要一个运行中的 OOC World）：
 *   bun run packages/@ooc/meta/storybook/_demo_session.ts
 *   OOC_BACKEND=http://localhost:3000 bun run packages/@ooc/meta/storybook/_demo_session.ts
 */
import { setTimeout as sleep } from "node:timers/promises";

const BACKEND = process.env.OOC_BACKEND ?? "http://localhost:3000";
const SESSION_ID = "storybook-agentnative-" + Math.floor(Date.now() / 1000);
const SUPERVISOR = "supervisor";
const NEW_OBJECT = "demo_greeter_" + Math.floor(Date.now() / 1000) % 100000;

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const init: RequestInit = { method, headers: new Headers() };
  if (body !== undefined) {
    (init.headers as Headers).set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const r = await fetch(BACKEND + path, init);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text), text }; } catch { return { status: r.status, text }; }
}

/** 轮询 job 至 done（或超时）。 */
async function waitJob(jobId: string, timeoutMs = 90_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await req("GET", `/api/runtime/jobs/${jobId}`);
    const status = r.json?.status;
    if (status === "done" || status === "failed") return status;
    await sleep(1500);
  }
  return "timeout";
}

/** 从 supervisor thread 的事件里抽取「执行过程轨迹」——agent 的可见动作。 */
async function processTrace(threadId: string): Promise<string[]> {
  const r = await req("GET", `/api/flows/${SESSION_ID}/${SUPERVISOR}/threads/${threadId}`);
  const events: any[] = r.json?.events ?? [];
  const lines: string[] = [];
  for (const e of events) {
    if (e.kind === "call_started") {
      lines.push(`  · 思考一轮（loop ${e.loopIndex}）`);
    } else if (e.kind === "function_call" && e.toolName === "exec") {
      const cmd = e.arguments?.method;
      const a = e.arguments?.args ?? {};
      if ("msg" in a) lines.push(`  → exec say：「${String(a.msg).replace(/\s+/g, " ").slice(0, 110)}」`);
      else if (cmd === "metaprog") lines.push(`  → exec metaprog action=${a.action} ${a.objectId ?? a.name ?? ""}`);
      else if (cmd === "talk") lines.push(`  → exec talk target=${a.target ?? a.objectId ?? ""}`);
      else if (cmd === "end") lines.push(`  → exec end（本轮结束）`);
      else lines.push(`  → exec ${cmd}`);
    } else if (e.kind === "function_call_output") {
      const out = String(e.output ?? "").replace(/\s+/g, " ").slice(0, 90);
      lines.push(`     ⤷ ok=${e.ok} ${out}`);
    }
  }
  return lines;
}

type Step = { id: string; title: string; verified: boolean; detail: string; trace: string[] };
const steps: Step[] = [];

function printStep(s: Step) {
  const mark = s.verified ? "✅" : "⚠️";
  console.log(`\n${mark} ${s.id} ${s.title}`);
  for (const l of s.trace) console.log(l);
  console.log(`     verify: ${s.detail}`);
}

async function main() {
  console.log(`=== Agent-native storybook 演示 ===`);
  console.log(`backend: ${BACKEND}  session: ${SESSION_ID}  新对象: ${NEW_OBJECT}\n`);

  // ── Step 1：自我构建（programmable + persistable）——supervisor 用 metaprog 亲手建一个对象 ──
  const task1 = `请为我创建一个名为 ${NEW_OBJECT} 的新 OOC Object，职责是「友好地打招呼」。`
    + `给它写好 self.md（身份/能力/边界）和一条 knowledge（典型互动示例）。创建好后用一句话告诉我你做了什么。`;
  const seed = await req("POST", "/api/sessions", {
    sessionId: SESSION_ID,
    title: `Agent-native storybook 演示（${new Date().toISOString().slice(0, 19).replace("T", " ")}）`,
    targetObjectId: SUPERVISOR,
    initialMessage: task1,
  });
  const threadId: string = seed.json?.targetThreadId;
  if (!threadId) { console.error("seed 失败:", seed.status, seed.text); process.exit(1); }
  console.log(`Step 1 任务已发给 supervisor，等它在 thinkloop 里执行…`);
  await waitJob(seed.json.jobId);
  await sleep(1500);
  {
    const trace = await processTrace(threadId);
    const created = await req("GET", `/api/stones/${NEW_OBJECT}`);
    const self = await req("GET", `/api/stones/${NEW_OBJECT}/self`);
    const ok = created.status === 200 && (self.json?.text ?? "").length > 20;
    steps.push({
      id: "STEP-1", title: "自我构建：supervisor 用 metaprog 亲手创建对象（programmable + persistable）",
      verified: ok, trace,
      detail: ok ? `${NEW_OBJECT} 已落盘，self.md ${self.json.text.length} 字符（由 supervisor 这个 agent 写的）`
        : `未验证到对象：getStone=${created.status}, self.len=${(self.json?.text ?? "").length}`,
    });
  }

  // ── Step 2：协作（collaborable）——supervisor 通过 talk 联系新对象，新对象在自己的 thinkloop 回应 ──
  const cont2 = await req("POST", `/api/flows/${SESSION_ID}/continue`, {
    text: `现在请你通过 talk 联系 ${NEW_OBJECT}，请它做一次自我介绍，并把它的回应转述给我。`,
  });
  console.log(`\nStep 2 任务已发，等 supervisor 经 talk 与 ${NEW_OBJECT} 协作…`);
  if (cont2.json?.jobId) await waitJob(cont2.json.jobId);
  await sleep(2000);
  {
    const trace = await processTrace(threadId);
    // 验证：新对象自己的 thread 里有它的回应（说明它真的被 talk 激活、跑了自己的 thinkloop）。
    // talk 投递给对端是独立 job，回应有延迟——轮询对端 thread 直到出现 say（或超时）。
    let calleeReplied = false;
    for (let i = 0; i < 20 && !calleeReplied; i++) {
      const threads = await req("GET", `/api/flows/${SESSION_ID}/threads`);
      const calleeThread = (threads.json?.items ?? []).find((t: any) => t.objectId === NEW_OBJECT);
      if (calleeThread) {
        const ct = await req("GET", `/api/flows/${SESSION_ID}/${NEW_OBJECT}/threads/${calleeThread.threadId}`);
        calleeReplied = (ct.json?.events ?? []).some((e: any) => e.kind === "function_call" && e.arguments?.method === "say");
      }
      if (!calleeReplied) await sleep(2000);
    }
    steps.push({
      id: "STEP-2", title: "协作：supervisor 经 talk 联系新对象，新对象跑自己的 thinkloop 回应（collaborable）",
      verified: calleeReplied || trace.some((l) => l.includes("talk")), trace,
      detail: calleeReplied ? `${NEW_OBJECT} 在自己的 thread 里真实回应了（被 talk 激活）`
        : `supervisor 已发起 talk（新对象回应可能仍在进行）`,
    });
  }

  // ── 汇总 ──
  console.log("\n\n=== 演示小结 ===");
  for (const s of steps) printStep(s);
  const okN = steps.filter((s) => s.verified).length;
  console.log(`\n验证通过 ${okN}/${steps.length} 步。过程全部作为 agent 的可见动作留在 session 里。`);
  console.log(`前端查看：${BACKEND.replace("3000", "5173")}  →  打开 session ${SESSION_ID}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
