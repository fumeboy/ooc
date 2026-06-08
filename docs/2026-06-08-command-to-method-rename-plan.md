# Req-2：移除 "command" 概念,统一为 "method"(window method)实现计划

> **For agentic workers:** 这是一次跨 100+ 文件的概念重命名。术语已定 **method**。不考虑向后兼容(用户明确)。
> 高风险点:① LLM 调用契约 `command=`→`method=` ② 持久化字段(thread/form 的 `command`)③ 知识激活键 `command::`(字符串匹配,tsc 抓不到)。

**Goal:** context window 的 "command" 概念已重命名为 window method;把 "command" 这个词从系统(代码标识符 / LLM 契约 / 知识键 / 文件名 / 文档)中移除,统一为 `method`。真·shell/CLI command 保留。

**Tech Stack:** TypeScript / bun。无新依赖。

---

## 术语映射(command → method)

| 旧 | 新 |
|---|---|
| exec/open 工具参数 `command="<name>"` | `method="<name>"`(LLM 契约,exec.ts schema + 所有教 LLM 的知识/文档) |
| `<command>` / `<commands>` XML 标签(LLM input) | `<method>` / `<methods>` |
| `MethodExecWindow.command` 字段 | `.method` |
| `MethodExecWindow.commandPaths` | `.methodPaths` |
| `StoneObjectDeclaration.commands` 字段(object-types.ts) | `.methods` |
| thread.ts 持久化 form 的 `command: string`(:332/:355/:375) | `method: string` |
| `command::<window_type>::<command>` 知识激活键 | `method::<window_type>::<command>` |
| 标识符 `callCommand`(53)/`xxxCommand`(closeCommand/setCommand/programCommand/sayCommand/continueCommand/waitCommand/formCommand/openFeishu*Command/setViewportCommand/reloadCommand/executeXxxCommand…) | `callMethod` / `xxxMethod` |
| 文件 `do/command.*.ts`(5)+ `talk/command.*.ts`(4) | `do/method.*.ts` / `talk/method.*.ts`(root 已是 method.*.ts) |
| `command_exec` window type 别名 | 移除(method_exec 唯一 canonical;删 method_exec/index.ts:78 注册 + object-registry BASE_TYPE_DEFINITIONS 条目) |
| permissions `policies.json commands[<command>]` | `methods[<method>]` |
| 散落注释/知识/文档里的 "command"/"命令" 概念词 | method(指 window method 时) |

## Keep-list(不改——真·shell/CLI 语义,非 context-window 概念)
- `packages/@ooc/core/executable/program/shell.ts`、`self-env.ts` —— LLM 跑的 shell 命令。
- `packages/@ooc/core/extendable/lark/cli.ts` —— CLI 命令。
- 代码注释里的**历史路径**(`源文件从 .../command_exec/...搬来`)——准确史料,保留。
- git/bash/外部工具的 "command" 字面。

## 持久化字段说明(无向后兼容)
thread.ts 的 `command` 字段进 thread-context.json(form/window 持久态)。重命名后,**存量 `.ooc-world*` 里的旧 thread JSON 会带旧字段名**——用户已明确不考虑向后兼容;测试用 fresh world 重建,不受影响。不写迁移、不留双读。

---

## 执行阶段(每阶段 `bun run check:tsc` 闸门;不能并行的标注)

**Stage 1 — 类型/契约地基(我亲自,不可并行)**:改核心类型字段名,让 tsc 把所有 call site 暴露出来:
- `MethodExecWindow.command`→`.method`、`commandPaths`→`.methodPaths`(method_exec/types.ts)
- `StoneObjectDeclaration.commands`→`.methods`(object-types.ts + object/types.ts)
- thread.ts form `command`→`method`(:332/:355/:375)
- exec.ts schema 参数 `command`→`method`(含 `required`、`args.command`、错误文案、注释)
- → 跑 tsc,得到全部断点清单。

**Stage 2 — 修 Stage 1 暴露的 call site + 标识符全局重命名(我亲自,不可并行)**:
- `callCommand`→`callMethod`、`xxxCommand`→`xxxMethod`(全局,grep+sed,排除 keep-list)
- 读 form.command / commandPaths / .commands 的所有点
- → tsc 干净。

**Stage 3 — LLM 标签 + hint(我亲自)**:`<command>`/`<commands>`→`<method>`/`<methods>`、exec hint `open(...command=...)`→`method=`(xml.ts / manager.ts / method_exec/readable.ts)。

**Stage 4 — 知识激活键 `command::`→`method::`(grep 驱动,tsc 抓不到)**:knowledge.ts / triggers.ts / basic-knowledge.ts / reflectable / object.doc.ts / cookbook / 所有 test+fixture。**改键须同时改产生键的代码与匹配键的代码,一致**。

**Stage 5 — 文件重命名 + 别名移除(我亲自)**:`git mv do/command.*.ts do/method.*.ts`(+talk)、改文件内标识符 + 所有 import;删 `command_exec` 别名注册。

**Stage 6 — 知识/文档 prose(sub-agent 可并行,按区)**:basic-knowledge / 各 window KNOWLEDGE 常量 / object.doc.ts / cookbook / meta docs 里 "command"/"命令" 概念词 → method,含 `open(command=...)` 示例 → `method=`。**每个 sub-agent owns 一组不重叠文件**。

**Stage 7 — 测试 + fixture(sub-agent 可并行,按区)**:test 里的 `command=` / `command::` / `xxxCommand` 引用同步;_fixture.ts 观测 helper(见记忆 e2e 观测漂移坑)。

**Stage 8 — 验证**:`bun run check:tsc` 干净;`bun test packages/@ooc/core packages/@ooc/builtins`(相对 merge 引入的 16 个 pre-existing 失败不新增);`bun run test:storybook` 0 fail(TC-THINK-03 等)。grep 残留 `\bcommand\b`(排除 keep-list + 历史注释)应趋零。

## 风险
1. **LLM 契约**:`command=`→`method=` 必须 exec schema + 所有知识示例**同步**,否则 LLM 用错参数名。Stage 3+4+6 必须一致收口。
2. **知识键**:`command::` 是字符串匹配,tsc 抓不到漏改;Stage 4 grep 必须穷尽产生侧 + 匹配侧。
3. **持久字段**:无 back-compat,存量 world 旧 thread JSON 字段失配——用户已接受。
4. **并行冲突**:Stage 1-5 跨文件标识符不可并行;只有 Stage 6-7(不重叠文件)可派 sub-agent。
5. **pre-existing 基线**:merge 的 16 个 TDZ 失败与本任务无关,验证时区分。
