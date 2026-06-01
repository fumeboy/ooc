/**
 * 文档维护说明 (cookbook.author-ooc-agent.doc)
 *
 * 本文件是 "如何编写一个标准 OOC Agent" 的端到端操作指南。
 *
 * 与其它 cookbook 的边界：
 * - cookbook.add-new-agent.doc.ts：本仓库内"加一个 AgentOfX 角色"的工程清单
 *   （harness/interim_runtime 形态，sub agent + stone 目录）
 * - **本文件**：面向**通用 Agent 作者**——以 plan §6 升级后的新形态（type=custom
 *   self window + ObjectWindowDefinition.commands）说明 stone 结构、命令注册、
 *   调用路径、热更与演化。新建一个 OOC Agent 时来这里抄。
 *
 * 维护原则：
 * 1. 复制粘贴优先：每个 example 都是可运行的最小代码。
 * 2. 与代码同步：当 ObjectWindowDefinition / loader / dispatcher 形态变化时，先更新本文件再更新 server/index.ts 模板。
 * 3. 概念深挖在 object.doc.ts.programmable；本文件保持"做什么、改哪些文件"的清单视角。
 */

type DocTreeNode = {
    title: string;
    content?: string;

    named?: Record<string, string>;

    children?: Record<string, DocTreeNode>;
    patches?: Record<string, DocTreeNode>;
    relations?: [[DocTreeNode, string]];
    sources?: [[any, string]];

    todo?: string[];
    warnings?: string[];
};

export const root: DocTreeNode = {
    title: "如何编写一个标准 OOC Agent",
    content: `
    OOC Agent = stones/<id>/ 下一组持久文件 + 一份 server/index.ts 注册的
    custom self window（plan §6 升级形态）。本指南覆盖从空目录到能跑的全流程。

    新形态对 Agent 作者的本质改变：

    - 旧：写 \`export const llm_methods = { ... }\`，LLM 通过 \`program.function\`
      间接调用 → 二等公民、无 form lifecycle、无 path 激活。
    - 新：写 \`export const window: ObjectWindowDefinition = { commands: { ... } }\`，
      LLM 通过 \`exec(window_id="custom:<self>", command="<name>", ...)\`
      直接调用 → 与 do_window/talk_window 上的命令完全同构，享受 form/refine/submit
      / path-based knowledge 激活 / submit 即执行的所有红利。

    \`ui_methods\` 字典保持不变（plan D3）：仍然给 web/agent-native 客户端通过
    HTTP \`callMethod\` 调用，与 LLM 路径完全解耦。

    Agent 自我演化的元编程闭环：
      LLM → \`exec(command="write_file", path="stones/<self>/server/index.ts", content="...")\`
        → loader 看到 mtime 变化 → ?t=mtime 强制重 import → 下一次调命令立刻看到新形态。
    `,
    named: {
        "stones/<id>/": "Agent 的 stone 目录；身份、知识、命令、UI 都在这里",
        "ObjectWindowDefinition": "server/index.ts 中 export const window 的形状（src/executable/server/window-types.ts）",
        "custom self window": "type=\"custom\" 的 ContextWindow，由 initContextWindows 在 thread.objectId === self 时幂等注入；id = `custom:<objectId>`",
        "ui_methods": "server/index.ts 中给前端 / agent-native 客户端用的方法字典；走 HTTP callMethod，不影响 LLM 路径",
        "热更": "loader 按 mtime 缓存；写文件后下一次调用自动 re-import",
    },
    children: {
        "step1_stone_skeleton": {
            title: "Step 1 — stone 目录骨架",
            content: `
            一个最小可用的 OOC Agent 在 stones/ 下需要这几样：

            \`\`\`
            stones/<id>/
            ├── self.md              # 第一人称身份；进 instructions
            ├── readme.md            # 第三人称对外自述；其他 Object 看你时读这个
            ├── server/index.ts      # custom self window + ui_methods（必备）
            ├── client/index.tsx     # 可选；对外的 web 单页入口（缺省走 Stone fallback）
            ├── data.json            # 自动维护；setData/getData 落盘
            ├── knowledge/           # 长期记忆 / 协议知识；按 frontmatter activates_on 自动激活
            │   ├── memory/<slug>.md
            │   └── relations/<peerId>.md   # 你对每个 peer 的关系认知
            └── skills/              # 可选；object 级 skills（仅自己的 thread 可见）
                └── <skill-name>/SKILL.md   # 详见后面 "Step X — 写 skill" 小节
            \`\`\`

            另外 branch 级公共 skills 路径：\`stones/<branch>/skills/<skill-name>/SKILL.md\`
            （跨所有 Object 共享；与 \`stones/<branch>/objects/\` 平级）。

            最小骨架命令（可以一次性跑完）:
            \`\`\`
            mkdir -p stones/factor_workshop/{server,client,knowledge/memory,knowledge/relations}
            \`\`\`

            身份文件可以从一句话起步：

            \`\`\`md
            # self.md
            我是因子工作台。我的职责是把研究员提的因子需求拆解成可执行的实验脚本。
            \`\`\`

            \`\`\`md
            # readme.md
            因子工作台（factor_workshop）：负责把因子需求拆解成实验脚本与回测任务。
            遇到 "新加因子 / 调参 / 跑回测" 类对话，可以 talk(target="factor_workshop") 找我。
            \`\`\`

            self.md 是给自己看的（系统注入 instructions），readme.md 是给别人看的
            （别人和你 talk 时系统作为 relation knowledge 注入）。两份文件都用第一/第三
            人称即可，不需要 frontmatter。
            `,
            named: {
                "self.md / readme.md": "身份文件；改它们立即影响下一轮 LLM",
                "knowledge/<topic>/<slug>.md": "长期 markdown 知识；frontmatter activates_on 决定何时激活",
                "data.json": "不直接编辑；通过 self.setData(key, value) 落盘",
            },
        },
        "step2_server_index_ts": {
            title: "Step 2 — server/index.ts 写 custom self window",
            content: `
            这是新形态的核心。server/index.ts 默认 export 两个 binding：

            - \`window\`（必备）：你的 custom self window 定义（type=custom）
            - \`ui_methods\`（按需）：给 web 前端用的 HTTP 方法字典

            最小可工作模板：

            \`\`\`ts
            // stones/factor_workshop/server/index.ts
            import type { ObjectWindowDefinition } from "ooc/executable/server/window-types";

            export const window: ObjectWindowDefinition = {
              title: "factor_workshop",
              description: "因子工作台 — 因子需求拆解 + 实验脚本生成",

              // 该 window 出现时合成的协议知识（每轮自动注入到 LLM context）
              basicKnowledge: () => \`
            你是 factor_workshop。可用命令（通过 exec(window_id="custom:factor_workshop", command="<name>", args={...}) 调用）:

            | command         | 作用                       |
            |-----------------|----------------------------|
            | create_factor   | 创建一个新因子草稿         |
            | publish_factor  | 把草稿提交到回测队列       |
              \`.trim(),

              commands: {
                create_factor: {
                  paths: ["create_factor", "create_factor.draft"],
                  match: (args) => {
                    const hit = ["create_factor"];
                    if (args.draft === true) hit.push("create_factor.draft");
                    return hit;
                  },
                  knowledge: (args, formStatus) => {
                    if (formStatus === "open" && !args.name) {
                      return {
                        "internal/windows/custom/create_factor/input":
                          "create_factor 需要 name 参数；refine(args={ name: \\"动量因子\\", formula: \\"...\\" }).",
                      };
                    }
                    return { "internal/windows/custom/create_factor/basic":
                      "create_factor: 创建一个因子草稿。args: { name, formula, draft? }" };
                  },
                  exec: async (ctx) => {
                    const name = String(ctx.args.name);
                    const formula = String(ctx.args.formula ?? "");
                    if (!name) return { ok: false, error: "缺少 name" };
                    const factors = (await ctx.self.getData("factors")) as
                      Record<string, unknown> ?? {};
                    factors[name] = { name, formula, status: "draft", createdAt: Date.now() };
                    await ctx.self.setData("factors", factors);
                    return { ok: true, result: \`因子 \${name} 已创建为 draft\` };
                  },
                },

                publish_factor: {
                  paths: ["publish_factor"],
                  match: () => ["publish_factor"],
                  exec: async (ctx) => {
                    const name = String(ctx.args.name);
                    const factors = (await ctx.self.getData("factors")) as
                      Record<string, { status: string }> ?? {};
                    const f = factors[name];
                    if (!f) return { ok: false, error: \`因子 \${name} 不存在\` };
                    f.status = "queued";
                    await ctx.self.setData("factors", factors);
                    return { ok: true, result: \`因子 \${name} 已加入回测队列\` };
                  },
                },
              },
            };

            // 可选：visible 维度入口；前端 client/index.tsx 通过 callMethod 调用
            export const ui_methods = {
              list_factors: {
                description: "列出所有因子（给前端看板用）",
                fn: async (ctx) => {
                  const factors = (await ctx.self.getData("factors")) ?? {};
                  return { factors };
                },
              },
            };
            \`\`\`

            **CommandTableEntry 字段语义**：

            - \`paths\`：本命令可能产出的所有 path 集合；用于 knowledge 反向激活索引。
            - \`match(args)\`：返回当前 args 命中的 path 子集（必含 bare command 名）。
              path 越具体，激活的 knowledge 越精确。
            - \`knowledge(args, formStatus)\`：返回 \`{ pathName: text }\`。formStatus 是
              form 当前状态（"open" | "executing" | "executed"），可用来在不同阶段
              派发不同提示。
            - \`exec(ctx)\`：真正执行入口。\`ctx\` 形态：
              - \`ctx.self\`: ProgramSelf（dir / callCommand / getData / setData / getThreadLocal / setThreadLocal）
              - \`ctx.thread\`: ThreadContext，可访问 contextWindows / events / inbox / outbox
              - \`ctx.parentWindow\`: 当前 custom window 自身
              - \`ctx.manager\`: WindowManager；要操作 contextWindows 走它，不要直接 mutate
              - \`ctx.args\`: form 累积的参数
              返回值：\`{ ok: true, result?: string }\` 或 \`{ ok: false, error: string }\`
              （也可返回裸 string / undefined，由 manager 兼容处理）。
            `,
            named: {
                "ObjectWindowDefinition": "{ title?, description?, renderXml?, basicKnowledge?, onClose?, commands? }",
                "CommandTableEntry": "{ paths, match, knowledge, exec } —— 与内置 window 命令完全同构",
                "CustomCommandContext": "exec 收到的 ctx；标准 CommandExecutionContext + self: ProgramSelf",
                "ctx.self.callCommand": "在命令内部调本对象其它命令：\`await ctx.self.callCommand(\"custom:<self>\", \"<name>\", { ... })\`",
                "ctx.self.getData/setData": "读写 stone 的 data.json；setData 是顶层 merge",
            },
        },
        "step3_invocation_paths": {
            title: "Step 3 — LLM 如何调用你的命令",
            content: `
            LLM 看到你的 custom window 之后，有两条调用路径（plan §6.5）：

            **路径 A：直接 open 命令（推荐）**

            \`\`\`
            exec(window_id="custom:<self>", command="create_factor", args={ name: "动量因子", formula: "..." })
            refine(form_id=..., args={ ... })   # 可选：分步填参
            submit(form_id=...)
            \`\`\`

            与 do_window.continue / talk_window.say 完全同构；form 生命周期、knowledge
            激活、submit 即执行的所有机制都自动适用。

            **路径 B：program.callCommand 通用元操作（脚本编排时用）**

            \`\`\`
            exec(command="program", args={
              window_id: "custom:<self>",
              command: "create_factor",
              args: { name: "动量因子", formula: "..." }
            })
            \`\`\`

            或者在 ts/js sandbox 里编排多次调用：

            \`\`\`
            exec(command="program", args={
              language: "ts",
              code: \`
                const r1 = await self.callCommand("custom:factor_workshop", "create_factor",
                  { name: "动量因子", formula: "..." });
                if (r1.ok) {
                  return await self.callCommand("custom:factor_workshop", "publish_factor",
                    { name: "动量因子" });
                }
                return r1;
              \`,
            })
            \`\`\`

            \`self.callCommand(windowId, command, args?)\` 不仅可调你自己的命令，还可调
            thread 内任意 window 上的命令（do_window.continue / file_window.edit 等都可）——
            把"调命令"统一成一个签名。
            `,
            named: {
                "exec(window_id=\"custom:<self>\", ...)": "直接路径；form lifecycle 完整",
                "program.callCommand": "脚本编排路径；可在 ts/js sandbox 里多步调命令",
                "self.callCommand": "ProgramSelf 上的统一入口；与 program.callCommand 共享同一行为",
            },
        },
        "step4_knowledge_and_relations": {
            title: "Step 4 — 写知识与关系（可选但强烈推荐）",
            content: `
            knowledge 文件用 markdown frontmatter 决定何时被激活：

            \`\`\`md
            ---
            description: 因子拆解的核心方法论
            activates_on:
              "command::root::create_factor": "show_content"
              "window::talk": "show_content"
            ---

            # 因子拆解方法论

            因子开发的核心步骤：
            1. 把因子语义拆成可计算的 formula
            2. 找到对应的数据源（quote / fundamentals / alt-data）
            3. ...
            \`\`\`

            把它写到 \`stones/<self>/knowledge/memory/factor-decomposition.md\`，下次
            LLM 在 \`exec(command="create_factor")\` 或与你 talk 时，系统会自动把这段
            knowledge 注入 context。

            关系文件 \`knowledge/relations/<peerId>.md\`：当 thread 里出现
            \`talk_window(target=peerId)\` 时自动激活两条 knowledge：

            - \`stones/<peer>/readme.md\`（peer 公开自述）
            - \`stones/<self>/knowledge/relations/<peer>.md\`（你对该 peer 的认知）

            如果你还没写 relation，第二条会显示占位提示，引导你按上述路径写入。

            关系文件示例：

            \`\`\`md
            # stones/factor_workshop/knowledge/relations/quant_research.md

            quant_research 是研究员，会发原始因子需求过来。
            - 他给的 formula 经常带数学符号；我要先转成可计算字符串再 create_factor
            - 他对回测耗时敏感；如果回测超过 30 分钟，先 talk 给他确认再继续
            \`\`\`

            形成新认知后通过 \`exec(command="write_file", path="stones/<self>/knowledge/relations/<peer>.md", content="...")\`
            或 \`exec(command="open_file") + edit\` 增量更新即可。下次再与该 peer 对话时，
            文件自动作为 knowledge 出现在你的 context。
            `,
            named: {
                "frontmatter activates_on (trigger map)": "Record<triggerExpr, 'show_description'|'show_content'>；三类 trigger：window::<type> / command::<window_type>::<command> / super",
                "stones/<self>/knowledge/memory/<slug>.md": "长期记忆；适合放方法论 / 协议 / 反思沉淀",
                "stones/<self>/knowledge/relations/<peer>.md": "对某个 peer 的关系认知；与该 peer talk 时自动激活",
            },
        },
        "step5_client_optional": {
            title: "Step 5 — client/index.tsx 写前端入口（可选）",
            content: `
            如果你的 Agent 需要被 web 用户直接看见（而不是只通过 OOC chat 交互），
            写 \`stones/<self>/client/index.tsx\`：

            \`\`\`tsx
            // stones/factor_workshop/client/index.tsx
            interface ClientProps {
              sessionId?: string;
              objectName?: string;
              callMethod?: (method: string, args?: object) => Promise<unknown>;
            }

            export default function FactorWorkshopClient({ sessionId, callMethod }: ClientProps) {
              return (
                <div style={{ padding: 16, fontFamily: "system-ui" }}>
                  <h1>因子工作台</h1>
                  <button onClick={async () => {
                    const result = await callMethod?.("list_factors", {}) as
                      { factors: Record<string, unknown> };
                    console.log(result.factors);
                  }}>
                    列出因子
                  </button>
                </div>
              );
            }
            \`\`\`

            **关键点**：
            - props 至少接 \`{ sessionId?, objectName?, callMethod? }\`
            - \`callMethod(name, args)\` 调你 server/index.ts 里 \`ui_methods[name]\` ——
              **不是 \`window.commands\`**（后者是给 LLM 的）
            - 没写 client/index.tsx 时 web 走 Stone fallback（自动展示
              self.md / readme.md / knowledge / Recent flows）

            Flow 级临时多页 \`flows/<sid>/objects/<self>/client/pages/<name>.tsx\` 用法相同。
            `,
            named: {
                "client/index.tsx": "stone 级单页入口；缺省走 Stone fallback",
                "callMethod (UI 路径)": "前端 props 注入；调 server/index.ts 的 ui_methods 字典；HTTP /api/{flows,stones}/.../call_method",
                "Stone fallback": "无 client/index.tsx 时 web 默认展示 self.md/readme.md/knowledge/Recent flows",
            },
        },
        "step5b_skills": {
            title: "Step 5.5 — 写 skill（可选；可复用操作模式）",
            content: `
            skills 让 Agent 把可复用的操作模式 / 协议 / 工作流程封装成独立目录，每个含
            \`SKILL.md\` + 任意辅助文件（references / scripts / 子文档）。

            **目录结构**（双层；按需选一层或两层都用）:

            \`\`\`
            # branch 级（跨 Object 共享）
            stones/<branch>/skills/<skill-name>/SKILL.md

            # object 级（仅自己的 thread 可见）
            stones/<branch>/objects/<self>/skills/<skill-name>/SKILL.md
            \`\`\`

            **SKILL.md 形态**：

            \`\`\`md
            ---
            description: 一句话说明这个 skill 解决什么问题；LLM 通过 description 决定是否进入
            ---

            # <Skill 名>

            ## 何时使用

            - 用户说 "..." 时
            - 任务匹配 "..." 模式时

            ## 步骤

            1. 第一步...
            2. 第二步...

            ## 参考文件

            - \`./references/<topic>.md\` — 详细规范
            - \`./scripts/<helper>.js\` — 辅助脚本
            \`\`\`

            **使用流程**（Agent 视角）:
            1. skill_index window 自动出现在 context（仅当至少有一个 skill 时）
            2. Agent 看 skill_index 列表 + description，按需 \`exec(command="open_file", args={ path: "<skillFilePath>" })\` 打开 SKILL.md
            3. 进一步 \`open_file\` 读 references / scripts
            4. 按 SKILL.md 指引完成任务

            **何时写 skill 而不是 knowledge / server method**:
            - knowledge：被动激活（按 command path 命中），适合"协议补全 / 行为习惯"
            - server method（custom command）：调用即执行，适合"明确无歧义的函数操作"
            - **skill**：主动选择（LLM 看索引判断要不要进入），适合"多步骤工作流 / 大块协议 / 需要辅助文件的复杂操作"

            **演化路径**：与其它 stone 资源一样，通过 \`exec(command="write_file", path="stones/<self>/skills/<name>/SKILL.md", content="...")\`
            写入；skill_index 在 10s 缓存窗口后自动刷新。
            `,
            named: {
                "SKILL.md frontmatter": "至少需要 description 字段；其它字段对 OOC 透明",
                "branch / object 双层": "branch 级共享，object 级私有；同名时 object 级优先",
                "10s TTL": "skill_index 缓存间隔；写新 skill 后 ≤10s 内 LLM 才会看到",
            },
        },
        "step6_evolution": {
            title: "Step 6 — 演化：Agent 自己改自己",
            content: `
            Agent 在运行中可以通过元编程自演化：

            \`\`\`
            exec(command="write_file",
                 path="stones/<self>/server/index.ts",
                 content="...")
            \`\`\`

            写完之后：

            1. loader 看到文件 mtime 变化 → ?t=mtime 强制重新 import
            2. 下一次 \`exec(window_id="custom:<self>", command="<name>")\` 或
               \`self.callCommand(...)\` 立即看到新命令
            3. **不需要重启进程、不需要重新部署**

            **增量演化更稳**：用 \`exec(command="open_file", args={path:...}) + edit\`
            在 \`window.commands\` 字面量里追加一条 key，比每次重写整文件更安全。

            **演化触发场景**：
            - 业务 thread 里发现一类操作反复手写 → 抽成 command 沉淀
            - super flow（反思场景）里发现一类问题反复出现 → 在 knowledge/memory/ 沉淀
            - 与 peer talk 时形成新认知 → 在 knowledge/relations/<peer>.md 沉淀

            **写权限边界**：
            - 业务 thread 里轻改自己的 stone（加 command / 写 memory）→ 直接 write_file
            - 结构性改动（改 self.md 身份、重组 server 模块、设计 client 主页）→
              通过 \`talk(target="super")\` 让 super 分身先帮你想清楚再写
            - 改别人的 stone：不允许直接 write_file；通过 metaprog 协议（PR-Issue / supervisor 评审）走

            热更不绕开 git：metaprog 协议提供 worktree → 试运行 → commit → merge 的安全路径，
            适合"改 stone 但需要 review / rollback"的场景。
            `,
            named: {
                "热更生效条件": "mtime 变化 → loader cache 失效 → 下一次调命令 re-import",
                "metaprog 协议": "结构性改动的安全路径；worktree + commit + merge；详见 reflectable.metaprogramming",
                "增量 edit": "open_file + edit 比重写整文件更稳；保留 git-friendly diff",
            },
        },
    },
    patches: {
        "ui_methods_isolation": {
            title: "ui_methods 与 window.commands 是两条平行通道",
            content: `
            两者表达的是不同维度的能力：

            - \`window.commands\`（programmable / executable.context_window）：
              给 LLM 的命令字典；通过 open/refine/submit 协议调用，享受 form lifecycle
              + path-based knowledge 激活。

            - \`ui_methods\`（visible）：
              给 web/agent-native 客户端的方法字典；通过 HTTP /call_method 调用，无
              form lifecycle，纯 RPC 形态。

            两者在 server/index.ts 里平行 export；调用入口、调用方身份、错误呈现位置都不同。
            一个动作到底该放哪个：**调用方是 LLM 还是用户/agent 客户端**。如果两者都需要，
            分别写两份。
            `,
        },
        "stone_vs_flow_scope": {
            title: "stone 是跨 session 的",
            content: `
            stones/<self>/ 跨所有 session 共享。同一个 Agent 在不同 session 里看见
            同一份 self window 与同一份 ui_methods。

            如需 session 特化逻辑（仅本次任务有效）：
            - 用 \`ctx.thread.persistence.sessionId\` 区分
            - 通过 self.getData/setData 持久化（落 data.json）
            - 通过 self.getThreadLocal/setThreadLocal 临时（不持久化）

            **不要** fork 一份新的 server/index.ts 来做 session 特化——会破坏 mtime 缓存的
            正确性，也跟"stone 是跨 session 共享"的语义矛盾。
            `,
        },
    },
    sources: [["src/executable/server/window-types.ts", "ObjectWindowDefinition 与 CustomCommandContext 的真值定义"]],
    todo: [
        "params schema 校验：当前 CommandTableEntry.match/knowledge 不强制 args 类型；如果未来加上，本指南需要补 schema 字段说明。",
        "示例工程：建议在仓库中添加一个 minimal-agent 示例 stone，跟随本指南可以一键跑起来。",
    ],
};
