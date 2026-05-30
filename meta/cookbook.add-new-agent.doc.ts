/**
 * 文档维护说明 (cookbook.add-new-agent.doc)
 *
 * 本文件是 OOC "添加一个新 AgentOfX" 的步骤清单, 与其它 meta/*.doc.ts 同形态。
 *
 * 维护原则:
 * 1. 这是一份 cookbook — 与概念文档 (object.doc.ts) 区别在于: 它直接告诉读者 "做什么 / 改哪些文件"。
 * 2. 每个 step 都应锚定到具体目录 / 文件 / API 调用, 让读者复制粘贴就能跑。
 * 3. cookbook 反映**当前 interim_runtime 形态**的步骤 (sub agent + stone 目录); 长期 dogfooding 落地后, 这份 cookbook 应该升级为 "通过 OOC 自己创建 AgentOfX" 的协议 (super flow 调用)。
 * 4. 当 stone 目录结构 / 协议 / harness 角色定义变化时, 这份 cookbook 是第一时间要更新的, 它对外部开发者上手友好度直接负责。
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

/**
 * cookbook.add-new-agent 根节点。
 *
 * 回答: 一个外部开发者拿到这个仓库, 想加一个新的 AgentOfX (例: AgentOfMonitor 监控告警维度),
 * 该改哪些文件、按什么顺序、怎么验证。
 */
export const root: DocTreeNode = {
    title: "Cookbook — 添加一个新的 AgentOfX",
    content: `
    本 cookbook 适用场景: 你想给 OOC harness 加一个**新的能力维度 Agent** (例: AgentOfMonitor, AgentOfAudit, AgentOfBilling)。
    OOC 当前内置 9 个 Agent (8 个 AgentOfX + 1 AgentOfExperience), 详见 \`meta/engineering.harness.doc.ts\`。

    **前提决策**: 你确定新维度是 OOC 概念体系中**缺失的一个独立能力维度**, 而不是已有维度的子能力。如果只是已有维度的功能加强 (例: thinkable 维度加一种新 knowledge source), 应该走那个维度 Agent 内循环, 不需要新建 stone。

    本 cookbook 假设 interim_runtime 阶段 (Claude Code sub agent 形态), 详见 \`meta/engineering.harness.doc.ts:patches.interim_runtime\`。
    长期 dogfooding 形态 (OOC 自己通过 super flow 创建新 stone) 的 cookbook 见 patches.future_dogfooding (TODO)。

    步骤总览:
    1. 在 \`meta/object.doc.ts\` 与 \`meta/engineering.harness.doc.ts\` 加新维度的概念定义 (Supervisor 哲学层)
    2. 在 \`.ooc-world/stones/agent_of_<x>/\` 创建 stone 目录骨架
    3. 写 \`self.md\` (Object 自己的身份) + \`readable.md\` (对外公开介绍)
    4. (可选) 写 \`executable/index.ts\` (方法库) + \`client/index.tsx\` (自己的 UI)
    5. 验证: web 控制面能看到新 stone + displayName 正确派生

    每一步详见 children。
    `,
    named: {
        "AgentOfX": "OOC harness 中负责某一个能力维度工程实现的 Agent; 详见 engineering.harness.doc",
        "stone": "Agent 跨 session 持续存在的部分; 目录在 stones/<objectId>/; 详见 object.doc:persistable.stone",
        "interim_runtime": "当前阶段: sub agent 形态; 详见 engineering.harness.doc:patches.interim_runtime",
        "dogfooding": "长期目标: OOC 用自己创建新 stone; 当前未实现",
    },
    children: {
        step1_concept: {
            title: "Step 1 - 在 meta 加新维度的概念定义",
            content: `
            最先做的事情, 也是最 Supervisor 视角的事情。
            外部开发者**应该 fork 后让自己人或 Claude Code Supervisor session 来做**, 不要让一个执行层 sub agent 改 meta。

            修改:
            1. \`meta/object.doc.ts\`: 在 \`root.children\` 加新维度节点 (照 thinkable / executable / collaborable 等的模板). 至少:
               - title: "OOC Agent <x> 概念"
               - content: 这个维度回答什么问题, 为什么独立, 边界在哪
               - named 词典
               - 与其它维度的 relations (例: 你的新维度与 observable / persistable 的关系)
            2. \`meta/engineering.harness.doc.ts\`: 在 \`root.children\` 加 \`agent_of_<x>\` 节点, 描述这个 Agent 的工作风格 + 内循环
            3. \`meta/engineering.harness.doc.ts\` 顶层 root.content 的 9 个 Agent 列表更新

            **硬性约定**: 每改一个 meta 文件立刻 \`bun tsc --noEmit meta/<file>.doc.ts\` 验证, 不要批量改完再验证 (见 CLAUDE.md \`关键约束 #2\` + auto memory).

            **不要做的事**:
            - 不要在概念都没定清楚时就开始建 stone 目录
            - 不要让 meta 节点充满未来计划 / todo (那些放进对应 Agent 的内循环, 不是文档)
            `,
            named: {
                "Supervisor 视角": "哲学层决策, 不绑定具体代码; 详见 engineering.harness.doc:children.supervisor",
                "bun tsc 立即验证": "项目硬性约定, 改 meta 跨文件 imports 时每写完一个文件立刻 tsc",
            },
        },
        step2_stone_skeleton: {
            title: "Step 2 - 创建 stone 目录骨架",
            content: `
            stone 是 Agent 跨 session 持久化的根目录。结构定义在 \`src/persistable/stone-object.ts:createStoneObject\`。

            手工创建 (interim_runtime 期):
            \`\`\`
            .ooc-world/stones/agent_of_<x>/
            ├── self.md           # 留空 step 3 写
            ├── readable.md       # 留空 step 3 写
            ├── client/           # 可选, step 4
            ├── executable/       # 可选, step 4
            ├── files/            # Object 用户文件留存
            └── knowledge/
                ├── memory/       # 长期记忆
                ├── relations/    # 对各 peer 的认知
                └── basic/        # (可选) 基本知识
            \`\`\`

            或用 HTTP API:
            \`\`\`bash
            curl -X POST http://localhost:3000/api/stones \\
              -H "Content-Type: application/json" \\
              -d '{"objectId":"agent_of_monitor"}'
            \`\`\`
            这只会创建 \`.stone.json\` 与基础骨架, **不会**写 self.md / readable.md / data.json (照 \`createStoneObject\` 留白契约, 详见 \`meta/object.doc.ts:persistable.stone\`)。

            **objectId 命名约定**:
            - kebab_case 不允许; 用 snake_case
            - 推荐前缀 \`agent_of_\` 表示这是 harness Agent (与用户创建的 Object 区分)
            - 一旦创建, objectId 即是这个 Object 的永久 ID, **不要重命名** (因为 web sidebar / Issue.createdByObjectId / talk-delivery 都按它定位)
            - displayName 通过 self.md 第一行派生, 详见 \`meta/object.doc.ts:visible.display_name_from_self_md\`; 不要在 stone 目录里另存 displayName

            **验证**: \`curl http://localhost:3000/api/stones\` 应在列表里看到新 objectId。
            `,
            named: {
                "createStoneObject": "stone 骨架创建函数; 不写入业务内容; src/persistable/stone-object.ts",
                "snake_case": "objectId 推荐命名; agent_of_monitor 而非 AgentOfMonitor",
                "objectId 不可改": "stone 创建后即永久 ID, displayName 通过 self.md 派生",
            },
        },
        step3_identity: {
            title: "Step 3 - 写 self.md 与 readable.md (给 Agent 身份)",
            content: `
            这一步**新 Agent 的身份诞生**。displayName 派生 (\`meta/object.doc.ts:visible.display_name_from_self_md\`) 也在这一刻生效。

            **self.md** — 对内身份 (Object 自己看; 也注入到 LLM 的 instructions):

            \`\`\`markdown
            # AgentOfMonitor （监控官）

            我是 AgentOfMonitor, OOC harness 的监控/告警维度 Agent。

            我做什么: 持续观测 OOC 系统的健康指标 (LLM API 配额、worker job 延迟、Issue 看板状态), 当指标越界时发起 talk_window 提醒对应维度的 AgentOfX。

            我不做: 主动改 src/ 代码 (那是对应维度 AgentOfX 的事)。

            权威定义: meta/engineering.harness.doc.ts:children.agent_of_monitor
            \`\`\`

            **第一行约定**: \`# AgentOfMonitor （监控官）\` 是 displayName 派生的数据源。空 / 缺失 → web UI fallback 到原 objectId。

            **readable.md** — 对外公开介绍 (其它 Object 在 collaborable.relation_knowledge 中读到):

            \`\`\`markdown
            # AgentOfMonitor （监控官）

            OOC harness 的监控/告警维度。

            找我做什么: 让我帮你监控某个指标 / 配置告警阈值 / 查询历史告警。
            不要找我做什么: 改 src/ 代码 (派单给对应维度 Agent), 写新 feature (我只观测不构建)。

            详见: meta/engineering.harness.doc.ts:children.agent_of_monitor
            \`\`\`

            **风格惯例** (参考已有 10 个 stone 的 self.md/readable.md):
            - self 写"我是谁、我做什么、我不做什么、谁定义我"
            - readable 写"找我做什么、不要找我做什么、谁定义我"
            - 第一行始终是 displayName 形态 (\`# <英文 PascalCase> （中文括号）\`)
            - 末尾指向 meta/engineering.harness.doc.ts 对应节点

            写完用 HTTP API 验证 displayName 派生:
            \`\`\`bash
            curl http://localhost:3000/api/stones/agent_of_monitor/self
            # 应返回 self.md 完整内容
            \`\`\`

            然后 web 控制面访问 \`http://localhost:5173/stones/agent_of_monitor\`, 应看到 Stone fallback 渲染的 Identity / About 两段, displayName 显示为 "AgentOfMonitor （监控官）"。
            `,
            named: {
                "displayName 派生": "self.md 第一行 # Title 去掉前导后 trim; 详见 object.doc.ts:visible.display_name_from_self_md",
                "self vs readme 体例区分": "self 第一人称、对内; readme 第三人称、对外",
            },
            sources: [["src/persistable/stone-self.ts", "readSelf / writeSelf 实现"]],
        },
        step4_methods_and_ui: {
            title: "Step 4 (可选) - 写 server method 库 + client UI",
            content: `
            如果新 Agent 需要被 LLM 或 UI 主动调用方法, 写 \`executable/index.ts\` (方法库)。详见 \`meta/object.doc.ts:programmable\`。
            如果新 Agent 需要自己的 UI 页面 (而不是用 Stone fallback), 写 \`client/index.tsx\`. 详见 \`meta/object.doc.ts:visible.stone_client\`。

            **executable/index.ts 模板**:

            \`\`\`ts
            // stones/agent_of_monitor/executable/index.ts
            import type { ObjectWindowDefinition } from "ooc/executable/server/window-types";

            export const window: ObjectWindowDefinition = {
                title: "agent_of_monitor",
                description: "监控 Agent 自我门面",
                commands: {
                    check_threshold: {
                        paths: ["check_threshold"],
                        match: () => ["check_threshold"],
                        knowledge: () => ({
                            "internal/windows/custom/check_threshold/basic":
                                "查询某个指标是否越界 (metric: cpu/memory/latency)",
                        }),
                        exec: async (ctx) => {
                            const metric = ctx.args.metric as string;
                            return { ok: true, result: "..." };
                        },
                    },
                },
            };

            export const ui_methods = {
                list_alerts: {
                    description: "供 web UI 列出当前 active 告警",
                    fn: async (self) => { /* ... */ },
                },
            };
            \`\`\`

            **client/index.tsx** (有了它会覆盖 Stone fallback):

            \`\`\`tsx
            export default function MonitorClient() {
                return <div>...</div>;
            }
            \`\`\`

            **如果你不写**: web 访问 stone detail 会走 Stone fallback (显示 self.md / readable.md / knowledge / Recent flows), 这是优雅的默认 — 不必为每个 Agent 强制写 client。

            **method 加载**: executable/index.ts 是 ESM 热加载 (mtime cache + ?t=mtime), 改完不需要重启 server, 详见 \`meta/object.doc.ts:programmable.method_evolution\`。
            `,
            named: {
                "window.commands / ui_methods": "method 分流: 前者给 LLM (program command 调), 后者给 web UI (HTTP callMethod 调)",
                "Stone fallback": "无 client/index.tsx 时 web 默认展示 self.md/readable.md/knowledge/Recent flows",
            },
        },
        step5_verify: {
            title: "Step 5 - 验证",
            content: `
            完成所有步骤后, 用以下 checklist 验证:

            **HTTP 层**:
            - [ ] \`curl http://localhost:3000/api/stones\` 列表含新 objectId
            - [ ] \`curl http://localhost:3000/api/stones/agent_of_monitor/self\` 返回 200 + self.md 内容
            - [ ] \`curl http://localhost:3000/api/stones/agent_of_monitor/readable\` 返回 200 + readable.md

            **Web UI**:
            - [ ] 访问 \`http://localhost:5173/welcome\`, "Talk to" dropdown 应有 displayName 选项 (例: \`AgentOfMonitor （监控官）\`)
            - [ ] 访问 \`http://localhost:5173/stones/agent_of_monitor\`, 应看到 Stone fallback 渲染身份页 (Identity / About / Knowledge / Entry points)
            - [ ] 访问 \`http://localhost:5173/stones\`, sidebar 应含新 Agent (displayName)

            **真实协作链路** (可选):
            - [ ] 从 Welcome 创建 session, target 选新 Agent, 发一句话, 应能看到 assistant 回复 (LLM 真调用走通)

            **每个 prompt 都跑 \`_test_<agent>_<ts>\` session 前缀** (详见 \`meta/engineering.harness.doc.ts:patches.test_session_hygiene\`), 跑完 rm。

            如果某一项失败, 退回对应 step 检查文件结构 / 内容。
            `,
        },
    },
    patches: {
        future_dogfooding: {
            title: "未来形态: OOC 自己创建新 stone (long-term)",
            content: `
            interim_runtime 阶段, 这份 cookbook 描述的是**外部开发者手工** (或人类与 Claude Code 协作) 创建新 stone 的步骤。

            长期目标 (dogfooding, 详见 \`meta/engineering.harness.doc.ts:patches.bootstrapping\`): OOC 内部的 Agent 自己通过 super flow + write_file 创建新 stone。
            那个时候这份 cookbook 应该升级为 "如何向 Supervisor 发起 super flow 提案: 我建议加一个新维度", 然后 Supervisor 通过 reflectable 决策并由 AgentOfPersistable 创建 stone 骨架。

            当前还没到, 所以这份 cookbook 仍是手工 + AI 协作风格。当 dogfooding 落地, 本节点应该重写。
            `,
            todo: [
                "dogfooding 落地后, 重写本 cookbook 为'super flow 提案 → AgentOfPersistable 自动创建'流程",
            ],
        },
        when_to_say_no: {
            title: "什么时候你不应该新建 AgentOfX",
            content: `
            这份 cookbook 帮你建一个新 Agent, 但更多时候答案是 **不应该建**。

            判断标准:
            - 如果你只是想给已有维度加一种新能力 (例: thinkable 加一种新 knowledge source), 走那个维度 Agent 内循环, 不需要新 stone
            - 如果你只是想观测某个指标, 用 observable 的 debug 落盘 + 看 web UI 即可, 不需要新 Agent
            - 如果你只是想自动化某个工作流, 写一个 ServerMethod 加到对应 stone 即可
            - 如果你的 Agent 不能用一句话回答 "我**独立的能力维度**是什么", 说明它还不是一个维度

            **真正需要新 AgentOfX 的信号**:
            - 它的工作内容明显不属于现有 8 维度的任一个
            - 它会被其它 Agent 频繁通过 talk_window 调用
            - 它有自己的长期记忆 (knowledge/memory) 与方法库
            - 它的 self.md 能写出一段完整身份描述, 不会撞已有 Agent
            `,
        },
    },
    warnings: [
        "本 cookbook 假设 .ooc-world 作为 world 目录; 如果你用不同 world (例: 部署到生产环境), 把 .ooc-world 替换成你的实际 world 路径",
        "objectId 一旦创建就是永久 ID, 不要重命名 — 它已经被持久化到 Issue.createdByObjectId / message.from / talk_window.target 等多处",
    ],
};
