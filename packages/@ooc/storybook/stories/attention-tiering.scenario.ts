/**
 * Storybook 场景（Tier B，真 LLM）：多轮 + 多对象对话，观察 **context 组成（attention 分层）** 与 **对话质量**。
 *
 * 验证 2026-06-14 的 attention 分层（见 docs/2026-06-14-context-axiom-implementation-record.md）：
 *   - 与 thread **creator（user）** 的对话 = 主要 attention = 全文进 LLM message 流；creator 窗在 context XML 仅句柄。
 *   - 与 **sub-thread（do）** 的对话 = 次要 attention = 全文在 do_window 的 XML transcript；message 流仅"新消息提示"（非全文）。
 *
 * 跑法（需运行中的 world + 真 LLM）：
 *   set -a && . ./.env && set +a && OOC_BACKEND=http://127.0.0.1:3000 \
 *     bun run packages/@ooc/storybook/stories/attention-tiering.scenario.ts
 *
 * 不进自动 runner（多轮真 LLM 较重）；作按需观察 / 回归案例。
 */
import {
  seedTask, continueTask, waitJob, threadExecs, fetchContextXml,
  threadLlmInfraFailed, renderTrace, backendReachable,
} from "../_harness/agent-native";

interface Check { id: string; ok: boolean | "skip"; detail: string }

export async function runAttentionTieringScenario(sid: string): Promise<{ checks: Check[]; trace: string[]; transcriptQuality: string }> {
  const checks: Check[] = [];

  // ── Round 1：派子线程 grep 'OOC'（创建 sub-thread = 次要 attention 窗），向 user 汇报 ──
  const seed = await seedTask(
    sid, "supervisor",
    "这是一个多轮对话。请用 do 派一个子线程去用 filesystem 成员的 grep 搜索 'OOC'，等子线程把命中数报回来后，" +
    "你用一句话告诉我命中多少条。记住这个数，我接下来会追问。",
    "attention 分层：多轮多对象",
  );
  if (!seed.ok || !seed.threadId) {
    return { checks: [{ id: "SEED", ok: false, detail: `seed 失败 status=${seed.raw.status}` }], trace: [], transcriptQuality: "" };
  }
  const tid = seed.threadId;
  await waitJob(seed.jobId!);
  const infra1 = await threadLlmInfraFailed(sid, "supervisor", tid);
  if (infra1) return { checks: [{ id: "INFRA", ok: "skip", detail: `LLM 端点抖动：${infra1}` }], trace: [], transcriptQuality: "" };

  // ── Round 2：续派——再 grep 'Agent'，对比两次（考验跨轮记忆 = 主要 attention 是否被 attend 到）──
  const cont = await continueTask(sid, "好。现在再用 do 派一个子线程搜 'Agent'，然后对比刚才 'OOC' 的命中数，一句话告诉我哪个命中更多。");
  if (cont.jobId) await waitJob(cont.jobId);
  const infra2 = await threadLlmInfraFailed(sid, "supervisor", tid);
  if (infra2) return { checks: [{ id: "INFRA", ok: "skip", detail: `LLM 端点抖动(R2)：${infra2}` }], trace: [], transcriptQuality: "" };

  // ── 观察 context 组成（最近一轮 LLM input）──
  const { ctxXml, messageStream } = await fetchContextXml(sid, "supervisor", tid);
  const stream = messageStream.join("\n");
  const execs = await threadExecs(sid, "supervisor", tid);
  const lastSay = [...execs].reverse().find((e) => e.msg)?.msg ?? "";

  // 提取 creator talk 窗 / do 窗（粗解析）
  const creatorWinMatch = ctxXml.match(/<window id="(w_creator[^"]*)"[^>]*class="talk"[^>]*>([\s\S]*?)<\/window>/);
  const creatorInner = creatorWinMatch?.[2] ?? "";
  const doWinMatches = [...ctxXml.matchAll(/<window id="([^"]*)" class="do"[^>]*>([\s\S]*?)<\/window>/g)];

  // TC1：creator（主要）—— 窗是句柄（含 transcript_in_messages、无内联 <transcript>）
  {
    const isHandle = creatorInner.includes("transcript_in_messages") && !creatorInner.includes("<transcript>");
    checks.push({ id: "TIER-CREATOR-HANDLE", ok: isHandle && !!creatorWinMatch,
      detail: `creator 窗=句柄(transcript_in_messages=${creatorInner.includes("transcript_in_messages")}, 内联transcript=${creatorInner.includes("<transcript>")})` });
  }
  // TC2：creator 对话全文在 message 流（多轮）——R2 的 'Agent' 指令应在 message 流、不在 creator 窗 XML
  {
    const inStream = /对比|Agent/.test(stream);
    const notInCreatorXml = !creatorInner.includes("对比刚才");
    checks.push({ id: "TIER-CREATOR-IN-MESSAGES", ok: inStream && notInCreatorXml,
      detail: `R2 指令在 message 流=${inStream}；不在 creator 窗 XML=${notInCreatorXml}` });
  }
  // TC3：sub-thread（次要）—— 若派了子线程：do 窗内联 transcript（全文在 XML），message 流出"次要 attention 提示"
  {
    const usedDo = execs.some((e) => e.cmd === "do");
    if (!usedDo || doWinMatches.length === 0) {
      checks.push({ id: "TIER-SUB-TRANSCRIPT", ok: "skip", detail: `agent 未派子线程(do)/无 do 窗(usedDo=${usedDo}, doWins=${doWinMatches.length})——次要层未触发，本次跳过` });
    } else {
      const anyDoInline = doWinMatches.some(([, , inner]) => inner.includes("<transcript>"));
      const hasSecondaryMarker = /次要 attention：新消息已到/.test(stream);
      checks.push({ id: "TIER-SUB-TRANSCRIPT", ok: anyDoInline,
        detail: `do 窗内联 transcript=${anyDoInline}（${doWinMatches.length} 个 do 窗）；message 流有次要提示=${hasSecondaryMarker}` });
    }
  }
  // TC4：对话质量（多轮连贯）—— 最终 say 应体现"对比两次"（跨轮记住 R1 命中数 = 主要 attention 起效）
  {
    const coherent = /多|少|相同|一样|对比|OOC|Agent|\d/.test(lastSay) && lastSay.length > 0;
    checks.push({ id: "QUALITY-MULTI-ROUND", ok: coherent, detail: `末轮 say：「${lastSay.slice(0, 120)}」` });
  }

  return {
    checks, trace: renderTrace(execs),
    transcriptQuality:
      `creator 窗(句柄):\n${creatorInner.trim().slice(0, 300)}\n\n` +
      `do 窗数=${doWinMatches.length}${doWinMatches[0] ? `；首个 do 窗片段:\n${doWinMatches[0][2].trim().slice(0, 300)}` : ""}\n\n` +
      `message 流条目数=${messageStream.length}`,
  };
}

if (import.meta.main) {
  const ok = await backendReachable();
  if (!ok) { console.error("backend 不可达（设 OOC_BACKEND + 启动 world）"); process.exit(1); }
  const sid = `sb-an-tier-${Math.floor(Date.now() / 1000) % 100000}`;
  console.log(`=== 多轮多对话 attention 分层场景 sid=${sid} ===\n`);
  const r = await runAttentionTieringScenario(sid);
  console.log("── 过程轨迹 ──\n" + r.trace.join("\n") + "\n");
  console.log("── context 组成观察 ──\n" + r.transcriptQuality + "\n");
  console.log("── 判据 ──");
  for (const c of r.checks) console.log(`${c.ok === "skip" ? "⏭️ " : c.ok ? "✅" : "❌"} ${c.id}  ${c.detail}`);
}
