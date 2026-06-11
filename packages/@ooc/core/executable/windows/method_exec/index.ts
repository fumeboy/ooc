/**
 * method_exec window — form lifecycle 的 LLM 视角统一抽象（P6.§9，2026-06-02）。
 *
 * 注册的 methods：
 * - refine：累积参数到 form.accumulatedArgs，重算 intentPaths
 * - submit：触发 form.method 真正执行
 *
 * type = "method_exec"（OOP 命名）。
 */

import { builtinRegistry } from "../_shared/registry.js";
import { refineMethod } from "./refine.js";
import { submitMethod } from "./submit.js";
import { readable } from "./readable.js";

const sharedMethods = {
  refine: refineMethod,
  submit: submitMethod,
};

builtinRegistry.registerExecutable("method_exec", {
  methods: sharedMethods,
  // form 是 method 调用过程的临时载体（Object 内置特性）—— 不写独立 dir，
  // 状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
  // form lifecycle 内部 type，方法表只能含 refine/submit；不该继承 root 的 talk/do/...
  parentClass: null,
});
builtinRegistry.registerReadable("method_exec", {
  readable,
});

