/**
 * 多轮多主题真实对话测试脚本。
 *
 * 用 OOC App Server 真实跑一个 Agent，发起 ≥3 主题、≥15 轮的对话，
 * 边跑边把现象记到 `report` 数组里，结束时打印。
 *
 * 运行：
 *   bun --env-file=.env scripts/dialog-experience.ts
 *
 * baseDir 用 `.ooc-world/` 保留 Agent 的长期产物（.gitignore 中已排除）。
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readServerConfig } from "../src/app/server/bootstrap/config";
import { buildServer } from "../src/app/server/index";
import { readThread, writeSelf } from "../src/persistable";

function loadEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const sep = t.indexOf("=");
    if (sep <= 0) continue;
    process.env[t.slice(0, sep)] ||= t.slice(sep + 1);
  }
}
loadEnv();

const BASE_DIR = resolve(process.cwd(), ".ooc-world");
mkdirSync(BASE_DIR, { recursive: true });

const SESSION_ID = `dialog-${Date.now()}`;
const OBJECT_ID = "assistant";
const THREAD_ID = "root";

const app = buildServer({
  ...readServerConfig(),
  port: 0,
  baseDir: BASE_DIR,
  workerPollMs: 50,
  workerEnabled: true,
});

async function api(path: string, body?: unknown, method = "POST"): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = method === "GET"
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
  const r = await app.handle(new Request(`http://localhost${path}`, init));
  let parsed: unknown;
  try {
    parsed = await r.json();
  } catch {
    parsed = await r.text();
  }
  return { status: r.status, body: parsed };
}

async function waitForJob(jobId: string, timeoutMs = 180_000): Promise<{ status: string; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body } = await api(`/api/runtime/jobs/${jobId}`, undefined, "GET");
    const j = body as { status: string; error?: string };
    if (j.status === "done" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { status: "timeout" };
}

interface Observation {
  turn: number;
  topic: string;
  user: string;
  jobOutcome: string;
  threadStatusAfter: string;
  thinkLoops: number;
  formExecutedCount: number;
  agentLastText?: string;
  notes: string[];
}

const observations: Observation[] = [];
const issues: string[] = [];

function note(turn: number, topic: string, text: string) {
  const obs = observations.find((o) => o.turn === turn && o.topic === topic);
  if (obs) obs.notes.push(text);
}

async function snapshotThread() {
  return await readThread(
    { baseDir: BASE_DIR, sessionId: SESSION_ID, objectId: OBJECT_ID },
    THREAD_ID
  );
}

async function turn(turnNo: number, topic: string, userText: string): Promise<void> {
  console.log(`\n=== Turn ${turnNo} [${topic}] ===`);
  console.log(`USER: ${userText}`);

  const before = await snapshotThread();
  const beforeLoops = before?.events.length ?? 0;

  const { status, body } = await api(
    `/api/flows/${SESSION_ID}/objects/${OBJECT_ID}/threads/${THREAD_ID}/continue`,
    { text: userText }
  );
  if (status !== 200) {
    issues.push(`turn ${turnNo}: continue 失败 status=${status} body=${JSON.stringify(body)}`);
    observations.push({
      turn: turnNo, topic, user: userText,
      jobOutcome: "continue-failed",
      threadStatusAfter: "?", thinkLoops: 0, formExecutedCount: 0, notes: [],
    });
    return;
  }
  const inj = body as { jobId: string };
  const jobResult = await waitForJob(inj.jobId);

  const after = await snapshotThread();
  const afterEvents = after?.events ?? [];
  const newEvents = afterEvents.slice(beforeLoops);
  const formExecutedNew = newEvents.filter(
    (e) => e.category === "context_change" && e.kind === "inject" && (e as { text: string }).text.startsWith("[form executed]")
  ).length;
  const lastText = [...afterEvents].reverse().find((e) => e.category === "llm_interaction" && e.kind === "text");

  const obs: Observation = {
    turn: turnNo,
    topic,
    user: userText,
    jobOutcome: jobResult.status,
    threadStatusAfter: after?.status ?? "?",
    thinkLoops: newEvents.filter((e) => e.category === "llm_interaction" && e.kind === "text").length,
    formExecutedCount: formExecutedNew,
    agentLastText: lastText && "text" in lastText ? lastText.text.slice(0, 200) : undefined,
    notes: [],
  };
  observations.push(obs);
  console.log(`AGENT: jobOutcome=${jobResult.status} status=${after?.status} form_executed=${formExecutedNew}`);
  if (lastText && "text" in lastText) console.log(`  text: ${lastText.text.slice(0, 240).replace(/\n/g, " ")}`);
  if (jobResult.status === "failed") issues.push(`turn ${turnNo}: job failed: ${jobResult.error ?? "(no error)"}`);
}

async function main() {
  console.log(`baseDir = ${BASE_DIR}`);
  console.log(`sessionId = ${SESSION_ID}`);

  // 1. 建 stone + self.md
  let r = await api("/api/stones", { objectId: OBJECT_ID });
  if (r.status !== 200 && r.status !== 422) issues.push(`createStone status=${r.status}`);
  // 即使 stone 已存在（重跑场景），也确保 self.md 是新的
  await writeSelf(
    { baseDir: BASE_DIR, objectId: OBJECT_ID },
    [
      "# Assistant",
      "",
      "你是 OOC 系统里的一个通用 assistant，能用 program(shell/ts/js/function) 操作文件系统、",
      "调用自己的 server 方法、读写 data.json。",
      "",
      "## 协作风格",
      "- 用户通过 continue 接口向当前 thread 追加新指令；你按指令推进任务、用 program 等 command 执行。",
      "- 一次 continue 只处理一项任务，做完后输出文本汇报，不要 wait。",
      "- 任务结束**不要 open(end)**，直接停在 status=running（让下一轮 continue 接着用）。",
      "",
      "## 重要协议",
      "- form result 同步可见；submit 后下一轮直接读 active_forms 中 result 字段。",
      "- 看完 executed form 的 result，用 close(form_id, reason=...) 释放，避免 context 越积越多。",
      "- shell 命令默认 cwd = OOC 项目根；想操作自己的目录用 env $OOC_SELF_DIR（自动注入，指向 stones/{objectId}）。",
      "- ts/js 代码可用 self.dir 取同一目录字符串。",
    ].join("\n")
  );

  // 2. 建 flow session + object
  r = await api("/api/flows/", { sessionId: SESSION_ID, title: "Dialog experience" });
  if (r.status !== 200) issues.push(`createSession status=${r.status} ${JSON.stringify(r.body)}`);
  r = await api(`/api/flows/${SESSION_ID}/objects/`, { objectId: OBJECT_ID });
  if (r.status !== 200) issues.push(`createFlowObject status=${r.status} ${JSON.stringify(r.body)}`);
  const initJob = (r.body as { jobId: string }).jobId;
  // 初始 run 会处理空 events——大概率立即结束或 wait
  const initRes = await waitForJob(initJob, 60_000);
  console.log(`initial job → ${initRes.status}`);

  // 3. 多轮多主题对话

  // 主题 1：自我介绍 + program shell 的基本操作
  await turn(1, "shell-basics",
    "你好。请用 program(shell) 命令打印当前工作目录（pwd）和 ls，告诉我你看到了什么。");

  await turn(2, "shell-basics",
    "src/ 目录下有多少 typescript 文件（不含 __tests__）？用 program(shell) 数一下。");

  await turn(3, "shell-basics",
    "刚才那些 .ts 文件总共多少行（用 wc -l）？给我一个总数。");

  // 主题 2：元编程 — 让 Agent 给自己写 server method
  await turn(4, "meta-program",
    "现在给你自己写一个 server method 叫 'wordcount'，接收 { text: string } 返回该文本的单词数。请用 program(shell) 写到 \"$OOC_SELF_DIR/server/index.ts\"（注意双引号包裹路径）。" +
    "示例：export const llm_methods = { wordcount: { description: '统计单词数', params: [{name:'text',required:true}], fn: async (_ctx, {text}) => String(text).split(/\\s+/).filter(Boolean).length } };");

  await turn(5, "meta-program",
    "调用刚才注册的 wordcount，传入 text='The quick brown fox jumps over the lazy dog'，告诉我数字。用 program(function='wordcount', args={text:...}) 模式。");

  await turn(6, "meta-program",
    "再给自己加一个 method 'greet'，接收 { name: string }，返回 'Hello, NAME!'。注意：保留 wordcount 不要删。然后调一次 greet({name:'world'})。");

  // 主题 3：data.json 持久化 — 跨轮累加状态
  await turn(7, "data-persistence",
    "用 program(ts) 调用 self.setData('counter', 1)，把 counter 字段初始化为 1。");

  await turn(8, "data-persistence",
    "现在用 program(ts) 把 counter 加 1（先 getData('counter')，再 setData('counter', 旧值+1)）。" +
    "告诉我新值。");

  await turn(9, "data-persistence",
    "再加 1。然后给我看 counter 当前是多少（用 self.getData）。");

  // 主题 4：自我修改 — 更新 self.md
  await turn(10, "self-modify",
    "用 program(shell) 在 \"$OOC_SELF_DIR/self.md\" 末尾追加一行：'## 最近偏好\\n- 简洁回复\\n- 中文优先'。" +
    "用 echo >> 或 cat <<EOF 追加。完成后用 cat 验证。");

  // 主题 5：综合题
  await turn(11, "synthesis",
    "做个综合：调 wordcount(text=self.md 第一行) 数一下。先用 program(shell) head -n 1 \"$OOC_SELF_DIR/self.md\" 拿到第一行，再 function='wordcount' 调用。两步分开做。");

  await turn(12, "synthesis",
    "把 counter 字段最终值写进 data.json 中的 'final_counter' 字段（用 self.setData）。然后 program(shell) cat data.json 给我看。");

  // 主题 6：边界探索
  await turn(13, "edge-cases",
    "试着 open(program, function='nonexistent_method') 然后 submit。看看系统返回什么——把 result 给我念出来。");

  await turn(14, "edge-cases",
    "用 program(shell) 跑一个会失败的命令：'cat /this-file-definitely-does-not-exist'。告诉我 exit code 和 stderr 大致写了什么。");

  await turn(15, "wrap-up",
    "回顾这次对话：你做了哪几件事？把它们列出来给我，每件一行。");

  // 收尾：打印总结
  const reportPath = resolve(BASE_DIR, `${SESSION_ID}-report.md`);
  const reportLines: string[] = [
    `# Dialog Experience Report`,
    ``,
    `**baseDir:** ${BASE_DIR}`,
    `**session:** ${SESSION_ID}`,
    ``,
    `## Turns (${observations.length})`,
    ``,
  ];
  for (const o of observations) {
    reportLines.push(
      `### Turn ${o.turn} — ${o.topic}`,
      ``,
      `- user: ${o.user.slice(0, 200)}`,
      `- jobOutcome: \`${o.jobOutcome}\``,
      `- threadStatus: \`${o.threadStatusAfter}\``,
      `- thinkLoops: ${o.thinkLoops}, formExecuted: ${o.formExecutedCount}`,
      o.agentLastText ? `- agentLastText: ${o.agentLastText.replace(/\n/g, " ").slice(0, 200)}` : "",
      ...o.notes.map((n) => `- note: ${n}`),
      ``
    );
  }
  if (issues.length > 0) {
    reportLines.push(`## Issues`, ``, ...issues.map((i) => `- ${i}`), ``);
  }
  await writeFile(reportPath, reportLines.filter((l) => l !== undefined).join("\n"));
  console.log(`\n=== Report saved: ${reportPath} ===`);
  console.log(`Total turns: ${observations.length}, issues: ${issues.length}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
