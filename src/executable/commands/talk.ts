import type { CommandExecutionContext, CommandTableEntry } from "./types.js";

/** talk command 暴露给 LLM 的知识说明。 */
export const KNOWLEDGE = `
talk 用于向另一个 Object 发送消息。

参数说明：
- target: 必填，目标对象名，或 creator / super
- msg: 必填，消息内容
- context: 可选，fork 或 continue
- threadId: 可选，目标线程 ID；continue 时通常需要
- type: 可选，relation_update 或 question_form
- wait: 可选，是否同步等待回复
- question_form: 可选，type=question_form 时附带结构化表单

调用示例：
open(type="command", command="talk", description="向 creator 反馈")
refine(form_id, { target: "creator", msg: "任务完成", context: "continue", threadId: "t_1", wait: true })
submit(form_id)
`;

/** talk command 的可匹配路径集合。 */
export enum TalkCommandPath {
  /** 基础 talk 指令：向目标对象发送消息。 */
  Talk = "talk",
  /** fork 模式：在指定线程下创建新的子线程进行对话。 */
  Fork = "talk.fork",
  /** continue 模式：继续已有远端线程进行对话。 */
  Continue = "talk.continue",
  /** wait 模式：等待目标对象同步回复。 */
  Wait = "talk.wait",
  /** 给当前 thread 的创建方发消息。 */
  ThreadCreator = "talk.thread_creator",
  /** 关系更新请求：通知对方处理关系信息变更。 */
  RelationUpdate = "talk.relation_update",
  /** 结构化问题表单：随 talk 消息携带可交互表单。 */
  QuestionForm = "talk.question_form",
}

/** talk command 表项：根据 context/wait/target/type 参数派生路径。 */
export const talkCommand: CommandTableEntry = {
  paths: [
    TalkCommandPath.Talk,
    TalkCommandPath.Fork,
    TalkCommandPath.Continue,
    TalkCommandPath.Wait,
    TalkCommandPath.ThreadCreator,
    TalkCommandPath.RelationUpdate,
    TalkCommandPath.QuestionForm,
  ],
  match: (args) => {
    const hit: string[] = [TalkCommandPath.Talk];
    const ctx = typeof args.context === "string" ? args.context : "";
    const type = typeof args.type === "string" ? args.type : "";
    const target = typeof args.target === "string" ? args.target : "";
    if (args.wait === true) hit.push(TalkCommandPath.Wait);
    if (ctx === "fork") hit.push(TalkCommandPath.Fork);
    if (ctx === "continue") hit.push(TalkCommandPath.Continue);
    if (target === "creator") hit.push(TalkCommandPath.ThreadCreator);
    if (type === "relation_update") {
      hit.push(TalkCommandPath.RelationUpdate);
    }
    if (type === "question_form") {
      hit.push(TalkCommandPath.QuestionForm);
    }
    return hit;
  },
  // 暂不实现具体执行逻辑
};

/** 执行 talk command；当前阶段显式拒绝跨 Object 通信，避免 LLM 误以为消息已送达。 */
export async function executeTalkCommand(ctx: CommandExecutionContext): Promise<void> {
  ctx.thread?.events.push({
    category: "context_change",
    kind: "inject",
    text: "[talk] 多 object 交互不属于当前单 object 阶段。"
  });
}
