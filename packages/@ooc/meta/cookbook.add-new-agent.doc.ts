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
    3. 写 \`self.md\` (Object 自己的身份) + \`readme.md\` (对外公开介绍)
    4. (可选) 写 \`server/index.ts\` (方法库) + \`client/index.tsx\` (自己的 UI)
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
            ├── readme.md         # 留空 step 3 写
            ├── client/           # 可选, step 4
            ├── server/           # 可选, step 4
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
            这只会创建 \`.stone.json\` 与基础骨架, **不会**写 self.md / readme.md / data.json (照 \`createStoneObject\` 留白契约, 详见 \`meta/object.doc.ts:persistable.stone\`)。

            **objectId 命名约定**:
            - kebab_case 不允许; 用 snake_case
            - 推荐前缀 \`agent_of_\` 表示这是 harness Agent (与用户创建的 Object 区分)
            - 一旦创建, objectId 即是这个 Object 的永久 ID, **不要重命名** (因为 web sidebar / Issue.createdByObjectId / talk-delivery 都按它定位)
            - displayName 通过 self.md 第一行派生, 详见 \`meta/object.doc.ts:visible.display_name_from_self_md\`; 不要在 stone 目录里另存 displayName

            **⛔ 硬性禁令: 不要建 \`src/\` 子目录**
            RPC helper、类型定义、渲染辅助等全部**内联**进 \`executable/index.ts\`（必要时可以用 \`executable/_types.ts\` / \`executable/_render.ts\` 等以下划线开头的 sibling 私有文件），但绝对不要建独立的 \`src/\` 子目录放可执行代码。原因：
            1. 路径语义冲突：\`src/\` 是"源码"的通用根，LLM 会通过 \`glob **/<object>/**/*.ts\` 把这些 helper 当成"可直接 import 的脚本"，绕过 ObjectMethod 契约（方法签名、默认值、错误处理、UI 方法双导出）。
            2. 权限边界破口：ObjectMethod 是 LLM 唯一合法的可编程入口，任何可被直接 import 的脚本文件都会在 Agent 出错时成为"绕过去执行"的捷径——这正是 session web-1780909890825 的触发路径（sentry 子对象的 \`src/factor-group-search.ts\` 被裸 import 导致 10,204 条因子组炸 context）。
            3. 合规参考实现：\`packages/@ooc/builtins/file\`（canonical 样板）、sentry stone 的 4 个子对象（factor / event / strategy / lineage）都遵循此约定，没有 \`src/\`。

            **验证**: \`curl http://localhost:3000/api/stones\` 应在列表里看到新 objectId。
            `,
            named: {
                "createStoneObject": "stone 骨架创建函数; 不写入业务内容; src/persistable/stone-object.ts",
                "snake_case": "objectId 推荐命名; agent_of_monitor 而非 AgentOfMonitor",
                "objectId 不可改": "stone 创建后即永久 ID, displayName 通过 self.md 派生",
            },
        },
        step3_identity: {
            title: "Step 3 - 写 self.md 与 readme.md (给 Agent 身份)",
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

            **readme.md** — 对外公开介绍 (其它 Object 在 collaborable.relation_knowledge 中读到):

            \`\`\`markdown
            # AgentOfMonitor （监控官）

            OOC harness 的监控/告警维度。

            找我做什么: 让我帮你监控某个指标 / 配置告警阈值 / 查询历史告警。
            不要找我做什么: 改 src/ 代码 (派单给对应维度 Agent), 写新 feature (我只观测不构建)。

            详见: meta/engineering.harness.doc.ts:children.agent_of_monitor
            \`\`\`

            **风格惯例** (参考已有 10 个 stone 的 self.md/readme.md):
            - self 写"我是谁、我做什么、我不做什么、谁定义我"
            - readme 写"找我做什么、不要找我做什么、谁定义我"
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
            如果新 Agent 需要被 LLM 或 UI 主动调用方法, 写 \`server/index.ts\` (方法库)。详见 \`meta/object.doc.ts:programmable\`。
            如果新 Agent 需要自己的 UI 页面 (而不是用 Stone fallback), 写 \`client/index.tsx\`. 详见 \`meta/object.doc.ts:visible.stone_client\`。

            **2026-06-02 ooc-6 P6 命名归一**: \`commands\` 字段已重命名为 \`methods\`；\`ObjectMethod\` 类型重命名为 \`ObjectMethod\`。
            旧名 \`commands\` / \`ObjectMethod\` 仍以 \`@deprecated\` alias 形式存在一个 release，新代码应直接用 \`methods\` / \`ObjectMethod\`。

            **server/index.ts 模板** (P6 形态):

            \`\`\`ts
            // stones/agent_of_monitor/server/index.ts
            import type { ObjectDefinition, ObjectMethod } from "@ooc/core/executable/windows";

            // 普通 method —— 返回 { ok: true, result?: string } 或 { ok: false, error: string }
            const checkThresholdMethod: ObjectMethod = {
                paths: ["check_threshold"],
                intent: () => [],
                onFormChange: () => [],
                exec: async (ctx) => {
                    const metric = ctx.args.metric as string;
                    // ctx.self 是 method 的 receiver window；ctx.thread 是当前 thread；
                    // 修改了独立 flow object 自身字段后可调 await ctx.reportStateEdit?.();
                    return { ok: true, result: \`metric=\${metric} ok\` };
                },
            };

            // Constructor method —— kind: "constructor"，返回 { ok: true, object: ContextObject }；
            // manager 自动 mount 到 thread.contextWindows（作为 ContextObject） + 按 isBuiltinFeature 分两路落盘。
            const monitorConstructor: ObjectMethod = {
                kind: "constructor",
                paths: ["agent_of_monitor"],
                intent: () => [],
                exec: async (ctx) => {
                    // 构造一个 ContextObject 实例并交给 manager；不要在这里直接 mutate thread.contextWindows。
                    return {
                        ok: true,
                        object: {
                            id: \`agent_of_monitor:\${Date.now()}\`,
                            type: "agent_of_monitor",
                            title: "Monitor session",
                            status: "active",
                            createdAt: Date.now(),
                        },
                    };
                },
            };

            export const object: Partial<ObjectDefinition> = {
                title: "agent_of_monitor",
                description: "监控 Agent 自我门面",
                // P6.§7: parentClass 缺省时隐式继承 "root"；表示 Agent 自动拿到 root 上注册的 talk / do /
                // todo / plan / program / open_file / open_knowledge / write_file / glob / grep / metaprog /
                // open_feishu_chat / open_feishu_doc 这一组通用 method，无需在 methods 表里再次声明。
                // 想完全独立可显式 parentClass: null（仅 root / method_exec 这种系统类型这样做）。
                parentClass: "root",
                methods: {
                    // 构造方法（与 type 同名是惯例；manager 通过 kind === "constructor" 标记定位）
                    agent_of_monitor: monitorConstructor,
                    // 普通方法
                    check_threshold: checkThresholdMethod,
                },
            };

            export const ui_methods = {
                list_alerts: {
                    description: "供 web UI 列出当前 active 告警",
                    fn: async (self) => { /* ... */ },
                },
            };
            \`\`\`

            **关键点**:
            - \`methods\` 字段是 canonical 名（\`commands\` 是 @deprecated alias，registry 内部双写以保持读取兼容）。
            - \`ObjectMethod\` 类型来自 \`@ooc/core/executable/windows\` barrel；旧名 \`ObjectMethod\` 仍可 import 但应迁移到 \`ObjectMethod\`。
            - \`kind: "constructor"\` 的 method 必须返回 \`{ ok: true, object: ContextObject }\`；manager 自动 mount 到 thread 的 context（作为 ContextObject），不要在 exec 里直接 \`thread.contextWindows.push(...)\`。
            - \`parentClass: "root"\` 让自定义 Agent 类自动继承 root 的所有通用 method；不写也等价（registry 默认 \`undefined → "root"\`）。

            **⛔ ObjectMethod 实现纪律**（三条缺一不可，违反 = 破协议）：
            1. **不要把 RPC helper / 业务逻辑对外导出** —— 全部 module-private，只通过 \`object.methods\` + \`ui_methods\` 对外暴露。任何 LLM 能走到的接口必须走 method。对应 stone 内不允许出现独立的 \`src/\` 子目录（见 step2 的硬性禁令）。
            2. **所有列表 / 搜索类 method**（返回集合结果的 RPC）必须在**至少两层**加默认分页：① 底层 helper 函数参数展开前注入 \`pageSize\` / \`pageNum\`（或接口惯用别名），② 对外通用入口（如 \`rpc_call\`）再查表注入一次。调用方显式传参始终优先生效，但不传时绝对不允许全表扫。
            3. **每个 ObjectMethod.exec 返回 JSON 字符串时必须包一层大小截断**（建议 200KB 上限），防止单条过大把下一轮 LLM 请求打 413。优先尝试"解析 JSON → 切片数组字段 → 保留结构 metadata"的智能截断，解析失败再回退到 raw 切片并附机器可读 \`[truncated]\` 后缀。参考实现：\`.ooc-world-sentry/packages/sentry-core/src/truncate-result.ts\` 的 \`truncateResult()\`。

            **client/index.tsx** (有了它会覆盖 Stone fallback):

            \`\`\`tsx
            export default function MonitorClient() {
                return <div>...</div>;
            }
            \`\`\`

            **如果你不写**: web 访问 stone detail 会走 Stone fallback (显示 self.md / readme.md / knowledge / Recent flows), 这是优雅的默认 — 不必为每个 Agent 强制写 client。

            **method 加载**: server/index.ts 是 ESM 热加载 (mtime cache + ?t=mtime), 改完不需要重启 server, 详见 \`meta/object.doc.ts:programmable.method_evolution\`。
            `,
            named: {
                "object.methods / ui_methods": "method 分流: 前者给 LLM (exec 调), 后者给 web UI (HTTP callMethod 调)",
                "ObjectMethod": "method 类型；canonical 名（旧名 ObjectMethod 是 @deprecated alias）",
                "kind: \"constructor\"": "标记此 method 是 Object class 的构造方法；返回 { ok: true, object } 由 manager 自动 mount",
                "parentClass": "registry 上 ObjectDefinition 的字段；缺省（undefined）= 隐式继承 \"root\"，让自定义 Agent 自动拿到 talk/do/todo/... 全套",
                "Stone fallback": "无 client/index.tsx 时 web 默认展示 self.md/readme.md/knowledge/Recent flows",
            },
        },
        step5_verify: {
            title: "Step 5 - 验证",
            content: `
            完成所有步骤后, 用以下 checklist 验证:

            **HTTP 层**:
            - [ ] \`curl http://localhost:3000/api/stones\` 列表含新 objectId
            - [ ] \`curl http://localhost:3000/api/stones/agent_of_monitor/self\` 返回 200 + self.md 内容
            - [ ] \`curl http://localhost:3000/api/stones/agent_of_monitor/readme\` 返回 200 + readme.md

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
