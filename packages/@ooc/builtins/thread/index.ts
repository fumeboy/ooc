/**
 * thread —— ooc class：agent 一次智能运行的载体，也是**唯一**会话载体注册 class。
 *
 * 所有会话窗（creator/peer/sub/fork）都是 thread 实例（inst.class=`_builtin/thread`）；talk /
 * reflect_request 不再是注册 class，而是 thread readable 按视角投影出的 window class
 * （context.md 核心 2/8/9）。
 *
 * 一处 `export const Class` 装配三维度：
 * - construct：造会话窗（peer / fork 两形态）；agent.talk 经 runtime.instantiate("_builtin/thread") 委托。
 * - executable：会话 say/close/share + reflectable 沉淀 new_feat_branch/create_pr_and_invite_reviewers。
 * - readable：3 个 window decl（thread/talk/reflect_request 投影）+ 内部 computeProjectionClass 算投影 class。
 *
 * thread 继承 root 缺省（package.json 无 `ooc.class`）。**wait 是 3 原语之一（非 method）**，独立 tool 入口。
 */
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";
import { talkConstructor } from "./executable/construct.js";
import executable from "./executable/index.js";
import readable from "./readable/index.js";
import type { Data } from "./types.js";

export const Class: OocClass<Data> = {
  construct: talkConstructor,
  executable,
  readable,
};

export type { Data } from "./types.js";
