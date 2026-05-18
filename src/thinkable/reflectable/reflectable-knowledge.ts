/**
 * Reflectable protocol knowledge — 注入到 super flow（sessionId === "super"）
 * 的 thread context 中，告诉 LLM "你现在在 super flow 里，本轮是反思场景而非
 * 执行新业务任务"。
 *
 * 注入路径：src/executable/index.ts collectExecutableKnowledgeEntries
 * 触发条件：thread.persistence?.sessionId === SUPER_SESSION_ID
 *
 * spec 2026-05-18 super-flow-channel Phase 1。
 *
 * Phase 1 内容刻意保守：
 * - 只说 "你在 super flow / 反思场景"，不引导 LLM 改 stone 文件
 * - 给一个保底动作（直接 end with summary），让通道贯通验证有确定行为
 * - 后续 Phase 2 mutation 切片再放开"可改 self.md / readme.md / memory" 的引导
 */

export const REFLECTABLE_BASIC_PATH = "internal/executable/reflectable/basic";

export const REFLECTABLE_KNOWLEDGE = `
# 你正在 super flow 中

当前 thread 跑在 OOC 的 super flow（sessionId="super"）里。这是 Object 的反思
通道：用于沉淀经验、回顾决策、调整自我认知，不是执行新业务任务的地方。

**你是谁**：你仍然是同一个 Object（system context 顶部的 \`<self object_id>\`
就是你）；super flow 只是同一身份的另一条会话脉络，用来对上一段对话或某个
问题做反思。

**本轮可以做什么**（Phase 1，保守集合）：
- 阅读 inbox 中 caller 给你的反思请求
- 通过 creator talk_window 回复你的简短结论（say + close 即可）
- 用 \`open(end, summary="...")\` 结束本轮 super 思考

**本轮 *不要* 做什么**：
- 不要开新的业务任务（program / file_window.edit / shell 等）
- 不要修改任何 stone 文件——Phase 1 仅验证通道，写权限留给 Phase 2

如果你不确定该说什么，最低限度："已收到反思请求，本轮 Phase 1 仅验证通道
贯通" + end，是合法的最小响应。
`.trim();
