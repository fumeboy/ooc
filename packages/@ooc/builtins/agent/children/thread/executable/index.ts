/**
 * thread —— executable 维度。thread 是唯一会话载体注册 class；它持有全部会话 object method：
 *   - say / reply                      —— 会话 method（method.say.ts）
 *   - end / todo                       —— thread 作用域操作（从 agent agency 迁入）
 *   - scan_changes / create_pr_for_versioned /
 *     sediment_unversioned / create_pr_for_class_edits  —— reflect_request 投影专属
 *     （仅 super flow self-view surface；method.reflect.ts；issue D 落地）
 *
 * 注：**wait 是 3 原语之一（非 method）**，经 `core/executable/tools/wait.ts` 独立 tool 入口。
 */
import type { ExecutableModule } from "@ooc/core/types";
import { sayMethod, replyMethod } from "./method.say.js";
import { endMethod } from "./method.end.js";
import { todoMethod } from "./method.todo.js";
import { reflectMethods } from "./method.reflect.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [
    sayMethod,
    replyMethod,
    endMethod,
    todoMethod,
    ...reflectMethods,
  ],
};

export default executable;
