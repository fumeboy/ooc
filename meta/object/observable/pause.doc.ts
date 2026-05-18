import type { Concept, DocNode, InvariantNode } from "@meta/doc-types";
import * as observable from "@src/observable/index";
import * as pauseStore from "@src/app/server/runtime/pause-store";
import * as enableGlobalPauseApi from "@src/app/server/modules/runtime/api.enable-global-pause";
import * as disableGlobalPauseApi from "@src/app/server/modules/runtime/api.disable-global-pause";
import * as getGlobalPauseStatusApi from "@src/app/server/modules/runtime/api.get-global-pause-status";
import * as pauseSessionApi from "@src/app/server/modules/flows/api.pause-session";
import * as resumeSessionApi from "@src/app/server/modules/flows/api.resume-session";

/* ────────────────────────────────────────────────────────────────
 *  目录页:从这块就能看到 Pause 概念的全貌
 * ──────────────────────────────────────────────────────────────── */

/**
 * Pause 概念:人工检查点,让对象在 LLM 返回后停下,允许介入再 resume。
 *
 * sources:
 *  - observable                — isPausing(thread) / setPauseChecker(...):thinkloop 调用入口
 *  - pauseStore                — 进程内全局 + 单 session pause 状态容器
 *  - enableGlobalPauseApi      — POST /api/runtime/global-pause/enable
 *  - disableGlobalPauseApi     — POST /api/runtime/global-pause/disable
 *  - getGlobalPauseStatusApi   — GET  /api/runtime/global-pause/status
 *  - pauseSessionApi           — POST /api/flows/:sessionId/pause
 *  - resumeSessionApi          — POST /api/flows/:sessionId/resume
 */
export type PauseConcept = Concept & {
  sources: {
    observable: typeof observable;
    pauseStore: typeof pauseStore;
    enableGlobalPauseApi: typeof enableGlobalPauseApi;
    disableGlobalPauseApi: typeof disableGlobalPauseApi;
    getGlobalPauseStatusApi: typeof getGlobalPauseStatusApi;
    pauseSessionApi: typeof pauseSessionApi;
    resumeSessionApi: typeof resumeSessionApi;
  };

  /** session / global 两层 pause 范围与状态生命周期 */
  scopes: DocNode & {
    sessionScope: DocNode;
    globalScope: DocNode;
    storeLifecycle: DocNode;
  };

  /** pause 在 ThinkLoop 中的固定检查点位置 */
  checkpoint: DocNode & {
    iterationOrder: DocNode & {
      step1BeginLoop: DocNode;
      step2FinishLoop: DocNode;
      /** pause 只在 LLM 返回之后、tool 调用之前生效 */
      step3PauseCheck: InvariantNode;
    };
    checkerInjection: DocNode;
    ephemeralThread: DocNode;
  };

  /** resume 的语义、步骤与 resume-thread job 内容 */
  resume: DocNode & {
    sessionResumeSteps: DocNode & {
      clearPauseFlag: DocNode;
      scanPausedThreads: DocNode;
      /** inboxSnapshotAtWait 必须清除 */
      flipStatusAndClearWait: InvariantNode;
      dispatchResumeJob: DocNode;
    };
    resumeJob: DocNode & {
      replayAssistantText: DocNode;
      executeCachedToolCalls: DocNode;
    };
    /** resume 恢复的是半轮工作而不是重新触发 LLM */
    semanticsSummary: InvariantNode;
  };

  /** 控制面边界(状态权威 / UI 触发点 / 查询契约) */
  controlPlane: DocNode & {
    stateOwnership: DocNode;
    uiEntries: DocNode;
    /** 提升为控制面能力必须配套 GET status */
    statusContract: InvariantNode;
  };
};

/* ────────────────────────────────────────────────────────────────
 *  数据填充
 * ──────────────────────────────────────────────────────────────── */

export const pause_v20260517_1: PauseConcept = {
  name: "Pause",
  sources: {
    observable,
    pauseStore,
    enableGlobalPauseApi,
    disableGlobalPauseApi,
    getGlobalPauseStatusApi,
    pauseSessionApi,
    resumeSessionApi,
  },
  description: `
Pause 是 OOC 的人工检查点:对象在 LLM 返回后停止继续执行,把最近输出保留下来,
允许人工介入,再 resume 接着把那一轮未执行的决策跑完。
`.trim(),

  scopes: {
    title: "两层 pause 范围",
    summary: "session / global 两层各有独立入口与作用域,状态生命周期共享",

    sessionScope: {
      title: "session 范围",
      summary: "POST /api/flows/:sessionId/{pause,resume},只影响该 session 的持久化线程",
      content: `
- 入口:POST /api/flows/:sessionId/pause 与 /resume
- 语义:只影响该 session 下持有 thread.persistence.sessionId 的线程
      `.trim(),
    },

    globalScope: {
      title: "global 范围",
      summary: "/api/runtime/global-pause/*,影响所有对象所有线程含纯内存线程",
      content: `
- 入口:POST /api/runtime/global-pause/{enable,disable,status}
- 语义:影响所有对象、所有线程,含无 persistence 的纯内存线程
      `.trim(),
    },

    storeLifecycle: {
      title: "状态生命周期",
      summary: "由 pauseStore 进程内维护,server 重启不保留",
      content: `
两层 pause 状态都由 pauseStore 在 server 进程内维护,互相独立;
server 重启不保留。
      `.trim(),
    },
  },

  checkpoint: {
    title: "暂停发生在 ThinkLoop 的哪个点",
    summary: "检查点固定在 LLM 返回之后、tool calls 执行之前",

    iterationOrder: {
      title: "单轮顺序",
      summary: "beginLlmLoop → finishLlmLoop → isPausing,顺序固定",

      step1BeginLoop: {
        title: "1. beginLlmLoop",
        summary: "Engine 构建 messages 后写 debug/llm.input.json",
        content: `Engine 构建 messages 后调用 beginLlmLoop,写入 threads/{id}/debug/llm.input.json。`,
      },

      step2FinishLoop: {
        title: "2. finishLlmLoop",
        summary: "LLM 返回后写 debug/llm.output.json,写入之后才检查 pause",
        content: `
LLM 返回,Engine 调用 finishLlmLoop,写入 threads/{id}/debug/llm.output.json。
注意这是写入**之后**才检查 pause——保证即使本轮被暂停,输出也已落盘可供 resume 用。
        `.trim(),
      },

      step3PauseCheck: {
        kind: "invariant",
        title: "3. isPausing 判定",
        summary: "pause 不打断进行中的 LLM HTTP 请求,只在 LLM 返回后 tool 调用前生效",
        content: `
调用 isPausing(thread) 判定:true → 线程状态置 paused、本轮不再执行任何 tool calls。
        `.trim(),
        rationale: `
打断进行中的 HTTP 请求会让 provider 返回半截响应,既无法 resume 又浪费已付费的 tokens。
固定在 LLM 返回后判定可让本轮输出完整落盘,resume 时可直接回放,而不必重发 LLM。
        `.trim(),
      },
    },

    checkerInjection: {
      title: "判定注入",
      summary: "app server 启动时 setPauseChecker 注入,observable 不知道 pause 来源",
      content: `
判定逻辑由 app server 启动时通过 setPauseChecker(...) 注入:
globalPause || isSessionPaused(thread.persistence?.sessionId)。
observable 与 thinkloop 不知道 pause 来源,只调用 isPausing(thread)。
      `.trim(),
    },

    ephemeralThread: {
      title: "纯内存线程行为",
      summary: "只受 global pause 影响,session-level 因缺 sessionId 自然不匹配",
      content: `
没有 persistence 的纯内存线程只受 global pause 影响。
session-level pause 因为缺少 sessionId 自然不匹配。
      `.trim(),
    },
  },

  resume: {
    title: "Resume 的语义",
    summary: "resume 不重新请求 LLM,只回放已缓存的输出",

    sessionResumeSteps: {
      title: "session resume 步骤",
      summary: "清 pause 标记 → 扫 paused 线程 → 翻状态 → 派发 resume-thread job",

      clearPauseFlag: {
        title: "1. 清除 pause 标记",
        summary: "在 pauseStore 清 session pause 标记",
        content: `
在 pauseStore 中清除该 session 的 pause 标记,避免新启动的线程立即又被 pause 拦截。
        `.trim(),
      },

      scanPausedThreads: {
        title: "2. 扫描 paused 线程",
        summary: "仅持久化线程可被恢复,纯内存线程的 paused 已随重启丢失",
        content: `
扫描 session 下持久化的 thread.json,找出 status === "paused" 的线程。
仅持久化线程会被恢复——纯内存线程的 paused 状态在 server 重启后已丢失。
        `.trim(),
      },

      flipStatusAndClearWait: {
        kind: "invariant",
        title: "3. 翻状态 + 清 inboxSnapshotAtWait",
        summary: "翻 status 回 running 同时必须清 inboxSnapshotAtWait",
        content: `
清掉 inboxSnapshotAtWait(如果之前在 wait 状态),把 status 翻回 running。
        `.trim(),
        rationale: `
inboxSnapshotAtWait 必须清除:避免 wait 唤醒条件用旧快照判定,导致漏 wake 或乱 wake。
保留旧快照会让 resume 后的线程错过新消息或在错误时机唤醒。
        `.trim(),
      },

      dispatchResumeJob: {
        title: "4. 派发 resume-thread job",
        summary: "为每个线程派发 job,返回 jobIds / resumedThreadIds 供追踪",
        content: `
为每个恢复的线程派发一个 resume-thread job,并返回 jobIds / resumedThreadIds
(让调用方可追踪每个线程的恢复情况)。
        `.trim(),
      },
    },

    resumeJob: {
      title: "resume-thread job 内容",
      summary: "从 llm.output.json 读上一轮决策,先回放 text 后执行 toolCalls",

      replayAssistantText: {
        title: "1. 回放 assistant text",
        summary: "把 assistant text 写回 events 恢复对话流,不重新调 LLM",
        content: `
先把 assistant text 作为 llm_interaction 写回 events,恢复 thread 的对话事件流。
不重新调 LLM,只回放已缓存的输出。
        `.trim(),
      },

      executeCachedToolCalls: {
        title: "2. 执行缓存的 toolCalls",
        summary: "按保存的顺序逐个执行 tool handler——pause 拦截时未执行的半轮工作",
        content: `
按保存的 toolCalls 顺序逐个执行 tool handler——这一步正是 pause 当时被拦截、
未执行的"半轮工作"。
        `.trim(),
      },
    },

    semanticsSummary: {
      kind: "invariant",
      title: "整体意义",
      summary: "resume = 跑完半轮工作,而不是重新触发 LLM 思考",
      content: `
resume 恢复的是"已拿到 LLM 输出、但还没来得及执行的那半轮工作",
而不是"重新触发 LLM 思考一遍"。
      `.trim(),
      rationale: `
若 resume 重新调用 LLM,人工介入的语义会被破坏——已经决策好的 toolCalls 可能被
重写,人付费检查点的逻辑也会失去意义。明确"只跑半轮"保证 pause 是确定的检查点。
      `.trim(),
    },
  },

  controlPlane: {
    title: "控制面边界",
    summary: "状态权威 + UI 触发点 + 状态查询契约",

    stateOwnership: {
      title: "状态权威",
      summary: "真值由 pauseStore 持有,web 只读取与触发",
      content: `
pause 是运行时状态,不是 UI 状态:真值由 pauseStore 持有,
web 只读取与触发,不在前端维护本地副本。
      `.trim(),
    },

    uiEntries: {
      title: "UI 触发点",
      summary: "session 接 chat composer 左下角 / global 接 MainLogo 顶部状态条",
      content: `
- session pause / resume 接入 chat composer 左下角按钮
- global pause / resume 接入 MainLogo 顶部状态条
      `.trim(),
    },

    statusContract: {
      kind: "invariant",
      title: "状态查询契约",
      summary: "控制面能力必须同时提供 GET status",
      content: `
一旦 pause 被提升成控制面能力,必须同时提供 GET status,
而不只是 enable / disable 的写入口。
      `.trim(),
      rationale: `
只有写入口没有读入口会让前端陷入"以为开了但其实没开"的不一致——尤其在
server 重启后状态丢失而前端缓存仍显示已开。GET status 是控制面的最小可观察性。
      `.trim(),
    },
  },
};
