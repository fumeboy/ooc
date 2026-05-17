import * as observable from "@src/observable/index";
import * as pauseStore from "@src/app/server/runtime/pause-store";
import * as enableGlobalPauseApi from "@src/app/server/modules/runtime/api.enable-global-pause";
import * as disableGlobalPauseApi from "@src/app/server/modules/runtime/api.disable-global-pause";
import * as getGlobalPauseStatusApi from "@src/app/server/modules/runtime/api.get-global-pause-status";
import * as pauseSessionApi from "@src/app/server/modules/flows/api.pause-session";
import * as resumeSessionApi from "@src/app/server/modules/flows/api.resume-session";

/**
 * Pause 概念：人工检查点，让对象在 LLM 返回后停下，允许介入再 resume。
 *
 * sources:
 *  - observable                — `isPausing(thread)` / `setPauseChecker(...)`：thinkloop 调用入口
 *  - pauseStore                — 进程内全局 + 单 session pause 状态容器
 *  - enableGlobalPauseApi      — POST /api/runtime/global-pause/enable
 *  - disableGlobalPauseApi     — POST /api/runtime/global-pause/disable
 *  - getGlobalPauseStatusApi   — GET  /api/runtime/global-pause/status
 *  - pauseSessionApi           — POST /api/flows/:sessionId/pause
 *  - resumeSessionApi          — POST /api/flows/:sessionId/resume
 */
export const pause_v20260517_1 = {
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
Pause 是 OOC 的人工检查点：对象在 LLM 返回后停止继续执行，把最近输出保留下来，
允许人工介入，再 resume 接着把那一轮未执行的决策跑完。
`.trim(),

  scopes_v20260517_1: {
    index: `
## 两层 pause 范围

session / global 两层各有独立入口与作用域；状态生命周期共享。详见子节点。
`.trim(),

    sessionScope_v20260517_1: {
      index: `
### session 范围

- 入口：\`POST /api/flows/:sessionId/pause\` 与 \`/resume\`
- 语义：只影响该 session 下持有 \`thread.persistence.sessionId\` 的线程
`.trim(),
    },

    globalScope_v20260517_1: {
      index: `
### global 范围

- 入口：\`POST /api/runtime/global-pause/{enable,disable,status}\`
- 语义：影响所有对象、所有线程，含无 persistence 的纯内存线程
`.trim(),
    },

    storeLifecycle_v20260517_1: {
      index: `
### 状态生命周期

两层 pause 状态都由 \`pauseStore\` 在 server 进程内维护，互相独立；
server 重启不保留。
`.trim(),
    },
  },

  checkpoint_v20260517_1: {
    index: `
## 暂停发生在 ThinkLoop 的哪个点

pause 不打断进行中的 LLM HTTP 请求。检查点固定在 LLM 返回之后、tool calls 执行之前。
详见三个子节点：单轮顺序、判定注入、纯内存线程行为。
`.trim(),

    iterationOrder_v20260517_1: {
      index: `
### 单轮顺序

1. Engine 构建 messages 后调用 \`beginLlmLoop\`，写入 \`threads/{id}/debug/llm.input.json\`
2. LLM 返回，Engine 调用 \`finishLlmLoop\`，写入 \`threads/{id}/debug/llm.output.json\`
3. 此时调用 \`isPausing(thread)\` 判定：true → 线程状态置 paused、本轮不再执行任何 tool calls
`.trim(),
    },

    checkerInjection_v20260517_1: {
      index: `
### 判定注入

判定逻辑由 app server 启动时通过 \`setPauseChecker(...)\` 注入：
\`globalPause || isSessionPaused(thread.persistence?.sessionId)\`。
observable 与 thinkloop 不知道 pause 来源，只调用 \`isPausing(thread)\`。
`.trim(),
    },

    ephemeralThread_v20260517_1: {
      index: `
### 纯内存线程行为

没有 persistence 的纯内存线程只受 global pause 影响。
session-level pause 因为缺少 sessionId 自然不匹配。
`.trim(),
    },
  },

  resume_v20260517_1: {
    index: `
## Resume 的语义

resume 不重新请求 LLM。详见三个子节点：session resume 步骤、job 内容、整体意义。
`.trim(),

    sessionResumeSteps_v20260517_1: {
      index: `
### session resume 步骤

\`POST /api/flows/:sessionId/resume\` 做的事：

- 在 pauseStore 中清除该 session 的 pause 标记
- 扫描 session 下持久化的 \`thread.json\`，找出 \`status === "paused"\` 的线程
- 清掉 \`inboxSnapshotAtWait\`，把状态翻回 running
- 为每个恢复的线程派发一个 \`resume-thread\` job，并返回 \`jobIds\` / \`resumedThreadIds\`
`.trim(),
    },

    resumeJob_v20260517_1: {
      index: `
### resume-thread job 内容

job 从 \`threads/{id}/debug/llm.output.json\` 读取上一轮缓存的 LLM 决策，
先回放 assistant text，再按保存的 toolCalls 逐个执行 tool handler。
`.trim(),
    },

    semanticsSummary_v20260517_1: {
      index: `
### 整体意义

resume 恢复的是"已拿到 LLM 输出、但还没来得及执行的那半轮工作"，
而不是"重新触发 LLM 思考一遍"。
`.trim(),
    },
  },

  controlPlane_v20260517_1: {
    index: `
## 控制面边界

分四个子节点：状态权威、UI 触发点、状态查询契约、observable 与 pause 的解耦。
`.trim(),

    stateOwnership_v20260517_1: {
      index: `
### 状态权威

pause 是运行时状态，不是 UI 状态：真值由 \`pauseStore\` 持有，
web 只读取与触发，不在前端维护本地副本。
`.trim(),
    },

    uiEntries_v20260517_1: {
      index: `
### UI 触发点

- session pause / resume 接入 chat composer 左下角按钮
- global pause / resume 接入 MainLogo 顶部状态条
`.trim(),
    },

    statusContract_v20260517_1: {
      index: `
### 状态查询契约

一旦 pause 被提升成控制面能力，必须同时提供 \`GET status\`，
而不只是 enable / disable 的写入口。
`.trim(),
    },
  },
};
