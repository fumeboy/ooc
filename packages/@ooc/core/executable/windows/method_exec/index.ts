/**
 * method_exec window — form lifecycle 的 LLM 视角统一抽象（P6.§9，2026-06-02）。
 *
 * 注册的 methods：
 * - refine：累积参数到 form.accumulatedArgs，重算 commandPaths
 * - submit：触发 form.method 真正执行
 *
 * basicKnowledge 在每轮 thread.contextWindows 出现至少一个 method_exec form 时自动作为
 * protocol KnowledgeWindow 注入到 LLM context，告诉 LLM 如何推进 form。
 *
 * 命名归一（P6.§1 + §9）：
 * - canonical type 字符串 = "method_exec"（OOP 命名）
 * - "command_exec" 保留为 legacy alias 一个 release，使旧持久化 state.json 仍可读
 * - 两者共享同一份 methods / readable / basicKnowledge
 *
 * 历史路径：本文件 originally 在 `packages/@ooc/builtins/command_exec/executable/index.ts`，
 *          §9 把它下放到 core 因为 form 是 Object 内置特性，不该是独立 builtin object。
 */

import { builtinRegistry } from "../_shared/registry.js";
import { refineMethod } from "./refine.js";
import { submitMethod } from "./submit.js";
import { readable } from "./readable.js";

const METHOD_EXEC_BASIC_KNOWLEDGE = `
method_exec form 是 LLM 调用某个 method 时的临时 sub-window。两条命令推进它：

| command | 作用 | 调用形态 |
|---------|------|----------|
| refine  | 累积/覆盖 form 的业务参数         | exec(window_id="<form_id>", method="refine", args={ <键值对> }) |
| submit  | 触发 form.method 真正执行       | exec(window_id="<form_id>", method="submit") |

**form 状态机 (Round 13)**: \`open → executing → success | failed\`

- **open**: 可继续 refine 或 submit
- **executing**: 短暂; 不要做动作
- **success**: 成功; 系统自动从 contextWindows 移除 (你下一轮看不到)
- **failed**: 失败; result 含错误; **可以 refine 修回 open 状态再 submit** (推荐路径)

**典型推进过程**：
1. exec(method="<X>", title="...", args={...}) → 若 args 不齐全，系统创建一个 form
2. exec(window_id=<form_id>, method="refine", args={ <补充键值对> }) → 累积参数
3. exec(window_id=<form_id>, method="submit") → 执行；success 自动释放, failed 保留 result

**failed 状态修复路径 (首选)**：
- exec(window_id=<form_id>, method="refine", args={ <修正参数> }) → form 自动切回 open + 清旧 result
- exec(window_id=<form_id>, method="submit") → 重新执行

**关键提醒**：
- exec 在 args 齐全时会立即执行（不创建 form）；只有需要多步填参时才会落到 form
- close 仍可用 (彻底放弃此次调用), 但不再是失败修复的首选 — refine-from-failed 保留 form 上下文 (knowledge / commandPaths / form id)
`.trim();

const sharedMethods = {
  refine: refineMethod,
  submit: submitMethod,
};

// P6.§9: canonical type "method_exec"（OOP 命名归一）。
builtinRegistry.registerObjectType("method_exec", {
  methods: sharedMethods,
  readable,
  basicKnowledge: METHOD_EXEC_BASIC_KNOWLEDGE,
  // P6.§6: form 是 method 调用过程的临时载体（Object 内置特性）—— 不写独立 dir，
  //         状态 inline 进所属 thread 的 context.json。
  isBuiltinFeature: true,
  // P6.§7: form lifecycle 内部 type，方法表只能含 refine/submit；不该继承 root 的 talk/do/...
  parentClass: null,
});

