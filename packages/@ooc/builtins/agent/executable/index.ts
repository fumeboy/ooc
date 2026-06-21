/**
 * agent —— executable 维度（agency object method）。
 *
 * agency 是 OOC Agent **基类能力**，归 agent class（从 root 搬迁而来）：
 * - talk : 开启会话 talk_window（peer 会话 / fork 子线程）
 * - plan : 把任务拆成可执行步骤的 plan 对象
 *
 * 继承 _builtin/agent 的具体 agent（supervisor 等）从此处拿 agency。
 * end/todo 是 thread 作用域操作，归 thread/executable（见 children/thread/executable/index.ts）。
 */

import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";
import { talkMethod } from "./method.talk.js";
import { planMethod } from "./method.plan.js";

const executable: ExecutableModule<Data> = {
  methods: [talkMethod, planMethod],
};

export default executable;
