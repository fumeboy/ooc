/**
 * thread —— executable 维度。thread 是唯一会话载体注册 class；它持有全部会话 object method：
 *   - say / reply                      —— 会话 method（method.say.ts）
 *   - end / todo                       —— thread 作用域操作（从 agent agency 迁入）
 *
 * 注：**wait 是 3 原语之一（非 method）**，经 `core/executable/tools/wait.ts` 独立 tool 入口。
 */
import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import { sayMethod, replyMethod } from "./method.say.js";
import { endMethod } from "./method.end.js";
import { todoMethod } from "./method.todo.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [
    sayMethod,
    replyMethod,
    endMethod,
    todoMethod,
  ],
};

export default executable;
