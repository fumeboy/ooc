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

| 范围 | 入口 | 语义 |
|---|---|---|
| session | POST /api/flows/:sessionId/pause、/resume | 只影响该 session 下持有 \`thread.persistence.sessionId\` 的线程 |
| global  | POST /api/runtime/global-pause/{enable,disable,status} | 影响所有对象、所有线程，含无 persistence 的纯内存线程 |

两层 pause 状态都由 \`pauseStore\` 在 server 进程内维护，互相独立；server 重启不保留。
`.trim(),
  },

  checkpoint_v20260517_1: {
    index: `
## 暂停发生在 ThinkLoop 的哪个点

pause 不打断进行中的 LLM HTTP 请求。检查点固定在 LLM 返回之后、tool calls 执行之前：

1. Engine 构建 messages 后调用 \`beginLlmLoop\`，写入 \`threads/{id}/debug/llm.input.json\`
2. LLM 返回，Engine 调用 \`finishLlmLoop\`，写入 \`threads/{id}/debug/llm.output.json\`
3. 此时调用 \`isPausing(thread)\` 判定：true → 线程状态置 paused、本轮不再执行任何 tool calls

判定逻辑由 app server 启动时通过 \`setPauseChecker(...)\` 注入：
\`globalPause || isSessionPaused(thread.persistence?.sessionId)\`。
没有 persistence 的纯内存线程只受 global pause 影响。
`.trim(),
  },

  resume_v20260517_1: {
    index: `
## Resume 的语义

resume 不重新请求 LLM。session-level \`POST /api/flows/:sessionId/resume\` 做的事：

- 在 pauseStore 中清除该 session 的 pause 标记
- 扫描 session 下持久化的 \`thread.json\`，找出 \`status === "paused"\` 的线程
- 清掉 \`inboxSnapshotAtWait\`，把状态翻回 running
- 为每个恢复的线程派发一个 \`resume-thread\` job，并返回 \`jobIds\` / \`resumedThreadIds\`
- resume-thread job 从 \`threads/{id}/debug/llm.output.json\` 读取上一轮缓存的 LLM 决策，
  先回放 assistant text，再按保存的 toolCalls 逐个执行 tool handler

因此 resume 恢复的是"已拿到 LLM 输出、但还没来得及执行的那半轮工作"。
`.trim(),
  },

  controlPlane_v20260517_1: {
    index: `
## 控制面边界

- pause 是运行时状态，不是 UI 状态：真值由 \`pauseStore\` 持有，web 只读取与触发。
- session pause / resume 接入 chat composer 左下角按钮。
- global pause / resume 接入 MainLogo 顶部状态条。
- 一旦 pause 被提升成控制面能力，必须同时提供 \`GET status\`，而不只是 enable/disable 的写入口。
- observable 与 thinkloop 不知道 pause 来源，只调用 \`isPausing(thread)\`；
  具体判定由 app server 在启动时注入。这让 observable 在纯内存测试与控制面 server 下复用同一套接口。
`.trim(),
  },
};
