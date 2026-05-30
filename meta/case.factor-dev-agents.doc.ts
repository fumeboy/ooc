/**
 * 文档维护说明 (case.factor-dev-agents.doc)
 *
 * 本文件记录 OOC 第一个外部业务场景 case：把哨兵平台的"因子开发助手"
 * (原 `~/x/go/plugins_with_agent/.agents/skills/` 下 15 个 SKILL.md) 收编为
 * 3 个 OOC Agent + 1 个项目级 skill 的形态。
 *
 * 维护原则：
 * 1. 本 case 文档**只描述 Agent 之间的协作 + 原子化分工 + skill 调用方式**, 不复述
 *    各 Agent 自己的 knowledge/memory/*.md 业务内容 (那些已迁到 stones/main/objects/<self>/knowledge/ 下)。
 * 2. 当任一 Agent 的 self/readable 协议变化、commands 增删、或 RPC 接入方式变化时, 本文档要同步。
 * 3. 与 `cookbook.add-new-agent.doc.ts` 区别: cookbook 教"怎么造新 Agent", 本 case 教"怎么把一组业务 skill
 *    用 Agent + skill 的方式表达"。两者互补。
 * 4. 本 case 的角色是**反推 OOC 设计是否够用**——如果遇到当前 OOC 协议表达不出来的细节,
 *    应该回到 `meta/object.doc.ts` 补维度定义, 而不是在本 case 里塞 workaround。
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
 * case.factor-dev-agents 根节点。
 *
 * 回答: 一组业务 skill (15 个 Claude Code SKILL.md) 如何按 OOC Agent + skill 的形态拆分组织,
 * 各 Agent 的协作图、原子化边界、psm-query skill 用法、RPC 接入模板。
 */
export const root: DocTreeNode = {
    title: "Case — 哨兵平台因子开发助手 (3 Agent + 1 Skill)",
    content: `
    本 case 把哨兵平台"因子开发助手" (源自 \`~/x/go/plugins_with_agent/\` 项目, 15 个 Claude Code SKILL.md)
    收编为 OOC 形态:

    - **3 个 OOC Agent** (业务领域 + 流程编排, 各自有自己的 stone 目录):
      - \`sentry_factor_dev\` — 因子开发流程**总编排**: 需求分析 / 技术方案 / 安全评估 / 派开发任务
      - \`sentry_event_factor\` — **事件因子领域** All-in-One: API 查询 + 知识 + 开发执行
      - \`sentry_factor_group\` — **因子组领域** All-in-One: API 查询 + 知识 + 开发执行 (go / offline 两种实现)

    - **1 个项目级 skill** (branch 级 skills/, 由任意 Agent 通过 skill_index window 发现):
      - \`psm-query\` — 根据需求文本检索候选 PSM/method 接口

    **文件位置** (主 world 即 \`.ooc-world\`):

    \`\`\`
    .ooc-world/stones/main/
    ├── objects/
    │   ├── sentry_factor_dev/        # Agent 1
    │   ├── sentry_event_factor/      # Agent 2
    │   └── sentry_factor_group/      # Agent 3
    └── skills/
        └── psm-query/                # 项目级 skill
            ├── SKILL.md
            └── query.js
    \`\`\`

    本 case 在 OOC 体系中扮演双重角色:
    1. **示范作用** — 给后续业务场景演示如何把"一堆零散 skill"按"领域 Agent + 流程编排 Agent + 通用 skill"
       的层次表达;
    2. **反推作用** — 这是 OOC 第一次承载真实业务 (而不是自举 harness 自身), 暴露的 OOC 协议缺口
       (custom window / do_window.move / skill_index / persistable.flow 等的实战体验) 都应回流到
       \`meta/object.doc.ts\` 与对应维度的 Agent 内循环。

    阅读本 case 之前先理解:
    - \`meta/object.doc.ts\` 的 \`thinkable\` (skill_index / knowledge auto-activation),
      \`executable\` (custom window + commands), \`collaborable\` (talk_window / do_window.move).
    - \`meta/cookbook.add-new-agent.doc.ts\` 中 stone 目录骨架。

    详细设计见 children: 协作图、3 个 Agent 各自分工、psm-query skill 用法、RPC 接入模板、
    设计决策记录。
    `,
    named: {
        "因子开发助手": "哨兵平台业务工具, 帮策略人员从'我要这个指标'一路到'落地代码已上线'",
        "事件因子": "绑定特定事件的因子 (例: 订单创建事件下的 order_amount); 详见 sentry_event_factor 的 knowledge/memory/event_factor_concepts.md",
        "因子组": "跨事件复用的通用因子集合, 有 go (实时) 和 offline (T+H 离线表) 两种实现; 详见 sentry_factor_group 的 knowledge/memory/factor_group_concepts.md",
        "PSM": "字节内部服务标识 (Product.Subsystem.Module); 因子组 go 实现需要明确依赖哪些 PSM",
        "skill_index window": "OOC 内置 window 类型, 自动列出当前 thread 可见的 branch 级与 object 级 skill; 详见 object.doc.ts:thinkable.skill_index",
        "DynamicRPC": "字节内部 HTTP 代理服务, 把 RPC 请求转 HTTP; URL 模板 https://aqomtm80.fn.bytedance.net?typ=DynamicRPC&...",
    },
    children: {
        topology: {
            title: "协作图 — 谁调谁、为什么这么拆",
            content: `
            **运行时拓扑**:

            \`\`\`
            user
              ↓ talk
            sentry_factor_dev (流程编排)
              │
              ├─ 用 psm-query skill (通过 skill_index window 看到; exec(open_file, SKILL.md) → exec(program, shell, node query.js))
              │
              ├─ talk → sentry_event_factor   (事件因子相关: 查 API / 派开发)
              │
              └─ talk → sentry_factor_group   (因子组相关: 查 API / 派开发)
              ↓ chat to user
              user
            \`\`\`

            **关键点**:
            1. \`sentry_factor_dev\` **不直接调** sentry_event_factor / sentry_factor_group 的 commands; 全部通过
               \`talk_window\` 异步沟通 (派任务 / 等回报 / 处理阻塞)。这保证三个 Agent 各自的 do_window 不互相污染,
               也让流程可以在 Web UI 上以多个 chat 同时观察。
            2. \`sentry_factor_dev\` 通过 \`do_window.move(mode="ref")\` 把 \`output/tech_plan.md\`
               file_window 共享给下游 Agent, 让对方读方案 (而不是把方案文本塞进 talk message)。详见
               \`meta/object.doc.ts:collaborable.do_window_move\`。
            3. \`psm-query\` 是 **skill 而非 Agent**: 不需要 talk, 不维护 stone 身份;
               任何 Agent 在自己 thread 中都能通过 \`skill_index\` window 看到它, 用 \`exec(program, shell, ...)\` 直接跑。

            **拓扑非循环**: sentry_factor_dev 是上游, 两个领域 Agent 是下游; 下游遇到阻塞时
            **反向 talk** 回 sentry_factor_dev (不是直接 talk 用户), 由 sentry_factor_dev 决定是补齐还是转交用户。
            循环约定写在 \`stones/main/objects/sentry/children/sentry_event_factor/knowledge/relations/sentry_factor_dev.md\` 与
            \`stones/main/objects/sentry/children/sentry_factor_group/knowledge/relations/sentry_factor_dev.md\`。
            `,
            named: {
                "do_window.move(mode=ref)": "do_window 共享只读快照给另一个 thread; 详见 object.doc.ts:collaborable.do_window_move",
                "talk_window": "Object 间跨 thread 异步消息; 详见 object.doc.ts:collaborable.talk_window",
            },
        },
        atomic_decomposition: {
            title: "原子化分工 — 为什么是 3 Agent + 1 Skill, 不是 5 Agent / 不是 1 Agent",
            content: `
            原项目 \`plugins_with_agent\` 共 15 个 SKILL.md, 平铺在 Claude Code 中。OOC 化时面临的关键设计选择:

            **方案 A — 1 个大 Agent (sentry_factor_assistant)** (拒绝):
            - 把所有 15 个 skill 都堆进一个 stone 的 knowledge/, 一个 executable/index.ts 30+ commands。
            - 缺点: 违背 OOC "Object 即领域" 的哲学; 任意改一个 API 都要重新加载整个巨石 prompt;
              事件因子和因子组的开发知识互相干扰激活 (activates_on 难维护)。

            **方案 B — 5 Agent + N skill** (拒绝):
            - 拆出 \`sentry_event_factor\` / \`sentry_factor_group\` / \`sentry_factor_dev\` (流程) / \`sentry_psm_query\` / \`sentry_security_assess\`。
            - 缺点: psm_query / security_assess 都是**纯函数式工具** — 没有跨 session 状态、没有领域知识沉淀、
              不需要被别人 talk;
              强制做 Agent 反而引入不必要的 stone 目录 / talk 协议负担。

            **方案 C — 3 Agent + 1 项目级 skill** ✅ (采纳):
            - 业务领域 (事件因子 / 因子组) 各拆独立 Agent: 各自有自己的开发知识、API commands、状态机;
              由领域专家维护时不互相影响。
            - 流程编排 (需求分析 / 方案 / 派开发) 单独 Agent: 它是**对外门面**, 用户从这里进入; 它有跨 session 状态
              (\`requirement.json\` / \`requirement_form.json\`)。
            - 通用工具 (psm-query) 作 skill: 一段无状态脚本, 通过 \`skill_index\` 协议被任意 Agent 发现;
              迁移成本极低 (照抄 query.js)。
            - 安全评估**不拆**: 它是 sentry_factor_dev 工作流的一个阶段 (写到 plan_template.md 的"安全评估清单"),
              不需要独立 Agent。

            **原子化边界判定准则** (从本 case 提炼, 可作为以后类似收编的指导):

            | 信号 | 应该当 Agent | 应该当 skill |
            |---|---|---|
            | 有跨 session 状态 (data.json / output/) | ✅ | ❌ |
            | 有领域专属知识库需要随上下文激活 | ✅ | ❌ |
            | 会被其它 Agent 通过 talk 频繁调用 | ✅ | ❌ |
            | 是无状态脚本 / 工具 | ❌ | ✅ |
            | 主要是 "给一段输入, 返回一段输出" | ❌ | ✅ |
            | 项目内多个 Agent 都可能用到 | ❌ | ✅ (branch 级 skill) |
            | 只有某一个 Agent 用 | ❌ | ✅ (object 级 skill) |
            `,
            named: {
                "branch 级 skill": "stones/<branch>/skills/<name>/, 任意 Agent 在 thread 中都能通过 skill_index 看到",
                "object 级 skill": "stones/<branch>/objects/<self>/skills/<name>/, 仅该 Object 自己看到",
                "activates_on": "knowledge/memory/*.md frontmatter 字段, 控制 LLM 上下文动态激活; 详见 object.doc.ts:thinkable.knowledge_activation",
            },
        },
        agent_factor_dev: {
            title: "Agent 1 — sentry_factor_dev (流程编排)",
            content: `
            **stone 路径**: \`.ooc-world/stones/main/objects/sentry_factor_dev/\`

            **身份** (self.md): 哨兵平台因子开发助手的总入口与编排; 用户面对的对外门面。

            **跨 session 状态**:
            - \`data.json\` (stone 级): 当前 active 需求列表、最近一次 chat UI marker。
            - flow 级 \`output/requirement.json\` / \`output/requirement_form.json\` / \`output/tech_plan.md\`:
              单次需求分析的产物 (per-flow), 由其内部状态机切换。

            **commands** (定义在 \`executable/index.ts\` 的 \`window: ObjectWindowDefinition\`):

            | command | 用途 |
            |---|---|
            | \`start_requirement(text)\` | 入口; 初始化 requirement.json |
            | \`analyze_requirement()\` | 启动需求分析 (8 题门禁), 产出因子清单 |
            | \`design_plan()\` | 写 tech_plan.md (含安全评估清单) |
            | \`assess_security(plan_path?)\` | 跑安全清单确认 |
            | \`dispatch_to_event_factor(plan_path)\` | 内部 talk → sentry_event_factor + 共享 plan file_window |
            | \`dispatch_to_factor_group(plan_path, mode)\` | 内部 talk → sentry_factor_group; mode 选 go/offline |
            | \`update_requirement_state(workflow)\` | 推进状态机 |
            | \`update_requirement_form(patch)\` | 更新结构化表单字段 |
            | \`emit_user_link(type, code)\` | 给用户的 chat 消息插入 \`[event_factor:CODE]\` / \`[factor_group:CODE]\` 标记, 触发 Web UI 跳链接 |

            **工作循环** (写在 self.md):
            \`接需求 → 分析 → psm 检索 → 写 plan → 安全评估 → 派开发 → 等回报 → 给用户回复\`。

            **knowledge** (\`knowledge/memory/\`): workflow_protocol / requirement_analysis_protocol / plan_template /
            chat_ui_markers / psm_query_usage; 详见各文件 frontmatter 的 \`activates_on\`。

            **不做的事**:
            - 不直接调 sentry_event_factor / sentry_factor_group 的 commands; 一律通过 talk 派任务。
            - 不直接写事件因子 / 因子组的代码; 那是下游 Agent 的事。
            `,
            named: {
                "8 题门禁": "需求分析时强制提问的 8 个问题, 详见 sentry_factor_dev/knowledge/memory/requirement_analysis_protocol.md",
                "状态机": "current_status: initialized / requirement_analyzing / requirement_blocked / psm_searching / planning / security_assessing / developing / testing / done / blocked",
                "chat UI marker": "插入 chat message 的特殊语法, web 端识别后渲染为可点击的因子链接; 详见 chat_ui_markers.md",
            },
        },
        agent_event_factor: {
            title: "Agent 2 — sentry_event_factor (事件因子领域)",
            content: `
            **stone 路径**: \`.ooc-world/stones/main/objects/sentry/children/sentry_event_factor/\`

            **身份** (self.md): 事件因子领域 All-in-One Agent — 包揽该领域的 API 查询、知识沉淀、开发执行。

            **commands**:

            | command | 用途 | RPC method |
            |---|---|---|
            | \`search_event_factors(eventId, query?, page?, size?)\` | 列事件下的因子 | \`EventFactorList\` |
            | \`get_event_factor_detail(code)\` | 拿单个事件因子详情 | \`EventFactorDetail\` |
            | \`search_events(query?)\` | 列业务事件 | \`EventSearch\` |
            | \`develop_event_factor(plan_path)\` | 按方案开发事件因子 (LLM 主导) | (无 RPC) |

            **RPC 接入** (写在 \`executable/index.ts\`): \`callDynamicRPC\` helper 调
            \`https://aqomtm80.fn.bytedance.net?typ=DynamicRPC&nowrap=1&psm=ecom.governance.openmind&method=<...>\`,
            通过 env \`USER_INFO\` 鉴权; 详见 \`children.rpc_template\`。

            **knowledge**: event_factor_concepts (3 种创建方式) / event_factor_dev_guide (开发规范) /
            event_factor_api (PSM/method/出入参 schema); 详见各 \`activates_on\`。

            **不做的事**:
            - 不主动 talk 用户; 都通过 sentry_factor_dev 中转。
            - 不维护需求状态机; 那是 sentry_factor_dev 的事。
            `,
        },
        agent_factor_group: {
            title: "Agent 3 — sentry_factor_group (因子组领域)",
            content: `
            **stone 路径**: \`.ooc-world/stones/main/objects/sentry/children/sentry_factor_group/\`

            **身份** (self.md): 因子组领域 All-in-One Agent — go / offline 两种实现都包揽。

            **commands**:

            | command | 用途 | RPC method |
            |---|---|---|
            | \`search_factor_groups(query?, page?, size?)\` | 列因子组 | \`FactorGroupSearch\` |
            | \`get_factor_group_detail(code)\` | 拿因子组详情 | \`FactorGroupDetail\` |
            | \`develop_factor_group(plan_path, mode)\` | 按方案开发; mode = "go" \\| "offline" | (无 RPC) |

            **mode 路由设计** (\`develop_factor_group\` 的 \`paths\` = \`["develop_factor_group", "develop_factor_group.go", "develop_factor_group.offline"]\`):
            - 调用方传 \`mode="go"\` / \`mode="offline"\`, command 内根据 mode 命中不同子路径,
              对应激活不同 \`activates_on\` 的 knowledge (factor_group_dev_go.md vs factor_group_dev_offline.md)。
              这是 OOC \`thinkable.knowledge_activation\` + custom window 协议组合, 详见 \`object.doc.ts\`。

            **mode 选择规则** (sentry_factor_dev 派任务时决定):
            - 数据源是 RPC/HTTP/Redis/Abase/TCC 实时调用 → \`mode="go"\`
            - 数据源是离线表, T+H 时延可接受 → \`mode="offline"\`

            **knowledge**: factor_group_concepts (go vs offline 边界) / factor_group_dev_go / factor_group_dev_offline /
            factor_group_api。
            `,
            named: {
                "go vs offline": "Go 实时调用 vs 离线表 T+H 同步; 选择策略详见 factor_group_concepts.md",
            },
        },
        skill_psm_query: {
            title: "Skill — psm-query (项目级)",
            content: `
            **路径**: \`.ooc-world/stones/main/skills/psm-query/{SKILL.md, query.js}\`

            **可见性**: 因为放在 \`stones/main/skills/\` (branch 级), 所有 main branch 下的 Agent 在自己 thread 中
            通过 \`skill_index\` window 都能看到它。

            **调用流程** (任一 Agent, 例如 sentry_factor_dev 在需要查接口时):

            \`\`\`
            1. 通过 skill_index window 列出可用 skill, 看到 psm-query
            2. exec(command="open_file", path="<skill_dir>/SKILL.md")
               读完整使用说明 (frontmatter description + body)
            3. exec(command="program", args={
                 language: "shell",
                 code: "node <skill_dir>/query.js \\"<需求文本>\\""
               })
               拿到 JSON 输出 (候选 PSM/method 列表)
            \`\`\`

            **为什么不做成 Agent 命令**:
            - psm-query 是无状态脚本 (PsmDataSource 数组 + AFS 检索), 没有需要在 stone 中沉淀的状态;
            - 多个 Agent (当前 3 个, 未来可能更多) 都可能用; 当 skill 比当 Agent 命令更通用;
            - SKILL.md frontmatter 的 description 直接被 \`skill_index\` 渲染为发现入口, 比新写一个 Agent 的 self/readable 更轻量。

            **psm-query 调的真实 HTTP**: AFS 检索接口 \`https://ecop.bytedance.net/api/governance_base/ecop/rpc/AgentAfs/AFSCommand\`,
            需要内网环境 + 鉴权。这个调用细节封装在 query.js 内, 上层 Agent 不需要关心。
            `,
            named: {
                "AFS": "字节内部 PSM 元信息检索服务, 给定自然语言查 PSM/method 候选",
                "PsmDataSource": "query.js 内置的 PSM 数据源数组, 描述哨兵平台关心的几个 PSM",
            },
        },
        rpc_template: {
            title: "RPC 接入模板 — callDynamicRPC",
            content: `
            \`sentry_event_factor\` / \`sentry_factor_group\` 的 \`executable/index.ts\` 各自包含一份 \`callDynamicRPC\`
            helper (~30 行), 用于调哨兵平台的 \`ecom.governance.openmind\` PSM。

            **模板**:

            \`\`\`ts
            const SENTRY_PSM = "ecom.governance.openmind";

            async function callDynamicRPC(
                method: string,
                body: unknown,
                timeoutMs = 30000,
            ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
                if (!process.env.USER_INFO) {
                    return { ok: false, error: "缺少 env USER_INFO（鉴权依赖）" };
                }
                const userInfo = \`&user_info=\${encodeURIComponent(process.env.USER_INFO)}\`;
                const url =
                    \`https://aqomtm80.fn.bytedance.net?typ=DynamicRPC&nowrap=1\` +
                    \`&psm=\${encodeURIComponent(SENTRY_PSM)}&method=\${encodeURIComponent(method)}\${userInfo}\`;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const res = await fetch(url, {
                        method: "POST",
                        headers: { accept: "*/*", "content-type": "application/json" },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });
                    const text = await res.text().catch(() => "");
                    if (!res.ok) return { ok: false, error: \`HTTP \${res.status}: \${text}\` };
                    return { ok: true, data: text ? JSON.parse(text) : {} };
                } catch (err) {
                    return { ok: false, error: \`RPC 调用失败：\${(err as Error).message}\` };
                } finally {
                    clearTimeout(timer);
                }
            }
            \`\`\`

            **设计取舍**:
            - 不抽公共 lib: 两份重复 (~30 行) 比强行抽到 src/ 拉外部依赖更轻; OOC 体系倾向于
              **stone 内自给自足** (objects/<self>/executable/ 应当独立可读)。
            - 错误**不抛**, 返回 \`{ ok, error }\` 让上游 LLM 自己判断是否要 retry / talk 用户;
              这与 OOC \`executable.command_exec\` 协议一致 (commands 不抛异常, 用结构化结果)。
            - **缺 USER_INFO 给清晰错误** (而不是 silent 失败), 方便用户在 web UI 上看到提示后补 env。

            **未来迁移到 lib 的信号**: 当第 3 个 Agent 也开始抄这段 helper 时, 应该把它抽到
            \`stones/main/objects/_shared/rpc.ts\` (或 OOC 提供的 \`servers/util/\` 模板)。当前 2 份重复仍在容忍范围。
            `,
            warnings: [
                "RPC URL 是字节内网域名 aqomtm80.fn.bytedance.net; CI 跑不通; 单元测试必须 mock fetch",
                "USER_INFO env 是用户级鉴权 token; **不要 commit 到 git**, 通过 .env 注入并 .gitignore",
            ],
        },
        protocols: {
            title: "Agent 间协作协议 (talk + do_window.move + 回报格式)",
            content: `
            **派任务协议** (sentry_factor_dev → 下游):

            1. \`exec(command="talk", target="sentry_event_factor")\` 创建 talk_window;
            2. \`exec(window_id=<talk>, command="say", text="...")\` 发派单消息, 内容含 plan_path + (factor_group 时还有 mode);
            3. \`exec(command="do_window.move", target_thread=<下游 thread>, mode="ref", window_id=<file:tech_plan.md>)\`
               把 plan file_window 共享给下游 (只读快照);
            4. wait 下游回报。

            **下游回报协议** (sentry_event_factor / sentry_factor_group → sentry_factor_dev):

            - 通过 \`creator do_window\` 上的 \`say\` 回报 (而不是 talk; 因为 do_window 已经是双方都能看的协作通道)。
            - 回报格式见 \`stones/main/objects/sentry/children/sentry_event_factor/knowledge/relations/sentry_factor_dev.md\` 与
              \`stones/main/objects/sentry/children/sentry_factor_group/knowledge/relations/sentry_factor_dev.md\` (各有具体模板)。

            **阻塞处理**:
            - 下游遇到阻塞 (缺接口 / plan 不清晰) → talk 回 sentry_factor_dev, 描述阻塞原因;
              **不要硬猜**, **不要直接 talk 用户**。
            - sentry_factor_dev 收到阻塞后决定: 补齐 plan 重派 / 转交用户 / 切到另一种实现。

            **为什么用 talk 而非 do**:
            - do_window 是协作通道, 适合双方共同看一个产物 (plan / 实现代码);
            - talk 是消息通道, 适合派任务 / 回报 / 异步沟通;
            - 派任务时**两者结合**: talk 发派单消息 + do_window.move 共享产物。

            权威协议定义在各 stone 的 \`knowledge/relations/<peer>.md\`;
            本节点是骨架描述, 不复述细节。
            `,
        },
        decisions: {
            title: "设计决策记录 (D1 - D7)",
            content: `
            | # | 问题 | 决策 |
            |---|---|---|
            | D1 | 拆分粒度 | **3 Agent + 1 Skill** (sentry_factor_dev / sentry_event_factor / sentry_factor_group + psm-query); 拒绝 1 Agent 巨石、拒绝 5 Agent 过细 |
            | D2 | sentry_api 走真实 RPC 还是 mock | **真实 RPC**; 每个 Agent 复制 callDynamicRPC helper; 单元测试 mock fetch |
            | D3 | 是否写 client/index.tsx | **不写**; 用 Stone fallback (object.doc.ts:visible.stone_client_fallback) |
            | D4 | world 范围 | **仅 .ooc-world** (主 world, 不污染 .ooc-world-test) |
            | D5 | case 文档 | **新增** \`meta/case.factor-dev-agents.doc.ts\` (本文件); **删除**旧 \`meta/case.factor-dev.doc.ts\` |
            | D6 | psm_query 形态 | **项目级 skill** (branch 级 stones/main/skills/psm-query/); 不作 Agent; 通过 skill_index 协议被任意 Agent 发现 |
            | D7 | knowledge 迁移方式 | 保留业务正文; 剥离 Claude 协议特有字段 (allowed-tools / context: fork / user-invocable); \`activates_on\` 改写为 OOC frontmatter 协议 |

            **删除的旧 stone** (本 case 替代它们):
            - \`.ooc-world/stones/main/objects/factor_requirement\`
            - \`.ooc-world/stones/main/objects/factor_workshop\`
            - \`.ooc-world/stones/main/objects/sentry_platform\`
            - \`meta/case.factor-dev.doc.ts\`
            `,
        },
        verification: {
            title: "验收 checklist",
            content: `
            完成本 case 后用以下 checklist 验证:

            **目录结构**:
            - [ ] \`.ooc-world/stones/main/skills/psm-query/{SKILL.md, query.js}\` 就位
            - [ ] 3 个 stone 目录就位 \`stones/main/objects/{sentry_factor_dev, sentry_event_factor, sentry_factor_group}/\`,
                 每个含 self.md / readable.md / executable/index.ts / data.json + knowledge/{memory, relations}/

            **类型与单测**:
            - [ ] \`bun tsc --noEmit\` baseline (不增加新 error)
            - [ ] \`bun test src/\` 全绿
            - [ ] 每个 Agent 至少 1 条 commands.exec 端到端单测, fetch mock

            **运行时**:
            - [ ] app server 启动 \`bun run --env-file=.env src/app/server/index.ts --world ./.ooc-world --stones-branch main\`
            - [ ] web UI Welcome 页可见 3 个 Agent
            - [ ] talk(target="sentry_factor_dev") 走通: skill_index 中能看到 psm-query, 可调用 program shell
            - [ ] sentry_factor_dev 能 talk + do_window.move 派任务给 sentry_event_factor / sentry_factor_group, 下游能回报
            - [ ] 真实 RPC 至少 1 个 happy path (用户配 USER_INFO 后能拿到真数据)

            **文档**:
            - [ ] 本文件 \`bun tsc --noEmit meta/case.factor-dev-agents.doc.ts\` 通过
            - [ ] 旧 \`meta/case.factor-dev.doc.ts\` 已删
            - [ ] CLAUDE.md 中"必读文档"表格的 case.factor-dev.doc.ts 行替换为本文件 (单独任务, 不在本 case 范围)
            `,
        },
    },
    patches: {
        gaps_for_ooc: {
            title: "本 case 暴露的 OOC 协议缺口 (回流到对应维度)",
            content: `
            收编过程中发现以下 OOC 协议**当前能表达但还不顺滑**的点, 应回流到对应维度的 Agent 内循环:

            1. **call共享 helper 的复用** (executable): 当前 callDynamicRPC 在 2 个 stone 中重复 ~30 行;
               OOC 暂无 \`stones/<branch>/lib/\` 或 stone 间共享代码的标准协议。短期 2 份重复可接受;
               长期需要补共享层定义 (object.doc.ts:executable + persistable)。

            2. **multi-mode command 的可发现性** (thinkable + executable): \`develop_factor_group\` 用 \`paths\`
               根据 \`mode\` 路由到不同 knowledge; 但调用方 (LLM) 没有标准协议告知它"应该传 mode"。
               现在靠 \`relations/sentry_factor_dev.md\` 文档约定, 长期应有 OOC 标准 (例如 commands schema 增 \`oneOf\` 描述)。

            3. **跨 Agent 状态可见性** (observable): sentry_factor_dev 派任务后等回报时, 它**看不到**
               sentry_event_factor 内部 do_window 的进度; 需要下游主动 say 才知道。
               长期可能需要 \`observable.peer_progress\` 协议 (但要权衡 over-coupling 风险)。

            4. **skill 与 Agent 的发现协议统一性** (thinkable): 当前 skill_index 是独立 window 类型;
               未来如果有 Object 同时提供"带状态命令"+"无状态 skill", 可能需要在 self.md 里同时声明两种入口。

            这些缺口**不阻塞本 case 落地**, 但作为反推 OOC 设计的输入, 应该在 \`meta/object.doc.ts\` 对应维度
            的 \`patches\` 节点中记录 (TODO)。
            `,
            todo: [
                "object.doc.ts:executable 加 patches.shared_lib_protocol — stone 间共享代码协议",
                "object.doc.ts:executable.commands 加 multi-mode 描述协议讨论",
                "object.doc.ts:observable 加 patches.peer_progress 讨论",
            ],
        },
    },
    warnings: [
        "callDynamicRPC 与 query.js 都依赖字节内网 + USER_INFO 鉴权; CI 不通; 单元测试必须 mock fetch",
        "本 case 是 OOC 第一个真实业务场景, 任何 OOC 协议层不顺滑的点都不要在 case 内 workaround, 应回流到 meta/object.doc.ts",
        "本 case 文件**不复述** stones/main/objects/<self>/knowledge/memory/*.md 的业务内容; 那是 Agent 自己的领域知识, 不属于 case 文档",
    ],
};
