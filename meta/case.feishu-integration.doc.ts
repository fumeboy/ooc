/**
 * 文档维护说明 (case.feishu-integration.doc)
 *
 * 本文件记录 OOC 与飞书 (Lark Suite) 集成的第一个 case：把飞书群聊与飞书文档作为
 * 一等 ContextWindow 引入 OOC，让 LLM 可以在 thread 上下文里直接打开、刷新、搜索、
 * 发送、追加飞书一侧的信息。
 *
 * 维护原则：
 * 1. 本 case 只描述**裁决与边界**——为什么是 Window 而不是 Agent、为什么强制 dry-run、
 *    身份默认为什么是 bot 等。具体 command 参数与 cli 拼装由 src/executable/windows/feishu_chat
 *    与 feishu_doc 自己的 KNOWLEDGE 字符串维护，本文档不复述。
 * 2. 当 lark-cli 子命令名 / 输出 schema 变化（larksuite/cli 升级）导致 normalizeMessages
 *    或 extractBlocks 失配时，第一时间核对 README，必要时回到本文档更新 §risks。
 * 3. 与 case.factor-dev-agents 的区别：那个 case 是"业务 skill 收编为 Agent"；本 case
 *    是"外部 SaaS 收编为 Window"。两种 case 共同回答"OOC 如何吃下外部世界"。
 * 4. 本 case 此刻只落地了 Window + 知识层，未建 Adapter Object（supervisor 拍板见 §decisions）。
 *    如果未来重新评估需要 Adapter Object（凭证 / 配额 / 共享状态升级到 stone 级），
 *    应该走 cookbook.add-new-agent 流程并把本 case 升级为"两层"叙述。
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
 * case.feishu-integration 根节点。
 *
 * 回答：飞书群聊 / 飞书文档 如何作为 ContextWindow 接入 OOC，强制 dry-run 与身份默认 bot
 * 的取舍来源，以及当前实现的边界与已知风险。
 */
export const root: DocTreeNode = {
    title: "Case — 飞书集成（feishu_chat / feishu_doc Window）",
    content: `
    本 case 把飞书 (Lark Suite) 的群聊与文档作为一等 ContextWindow 引入 OOC。
    实现形态是**单层 Window**：

    - \`feishu_chat_window\` — 飞书群聊 / 单聊 / 话题；commands: refresh / search / send / reply / subscribe / close
    - \`feishu_doc_window\`  — 飞书 doc / docx / sheet / base / wiki / drive_md；commands: read / search_in_doc / append / patch_block / share_link / attach_to_chat / close
    - root commands 入口：\`open_feishu_chat\` / \`open_feishu_doc\`

    所有飞书 OAPI 调用收口到 \`src/executable/windows/_shared/lark-cli.ts\` 的 \`larkExec\` helper，
    通过子进程方式调用官方 \`@larksuite/cli\`（Go 二进制，带 OS keychain 凭证存储 + OAuth device-code 流）。

    **不在本 case 范围**：
    - 飞书日历 / 邮件 / 多维表格 / 视频会议 / 通讯录 / 审批 — 同样可走相同 Window 模板，但每个域要单独立 case。
    - 凭证管理 / OAuth login — 由 lark-cli 自己负责（OS keychain）；OOC 不复制存储 secret。
    - 真正的事件订阅 / webhook — 当前阶段 \`feishu_chat.subscribe\` 仅写字段意愿，poller 集成 TBD（见 §future）。

    本 case 在 OOC 体系中扮演的角色：
    1. **示范作用** — 给后续"外部 SaaS 接入"提供模板（lark-cli helper + Window type + 强制 dry-run gate）。
    2. **反推作用** — 暴露 OOC 当前对外部副作用、版本飘移检查、轮询订阅的协议短板，
       回流到 \`meta/object.doc.ts\` 的 reflectable / observable / collaborable 子树。

    详细设计见 children：单层 vs 两层裁决、Window 命令分布、强制 dry-run gate 实现、风险与 future。
    `,
    named: {
        "lark-cli": "larksuite/cli, Go 编写的飞书官方 CLI；OOC 通过子进程调用",
        "Window 单层": "本 case 不建 Adapter Object stone；所有逻辑落在 Window type 与共用 helper 上",
        "dry-run gate": "写类命令必须先走 lark-cli --dry-run，refine confirm=true 后才真发",
        "身份默认 bot": "群聊 send/reply 默认 --as bot；其它读类命令默认 --as user",
        "subscribe 轮询": "current 仅写字段意愿；poller 集成是未来工作",
    },
    children: {
        decisions: {
            title: "关键裁决（supervisor 拍板）",
            content: `
            实施前 supervisor 对设计方案的几条裁决，决定了当前实现形态：

            1. **单层而非两层** — 不新建 \`agent_of_feishu\` Adapter Object stone。
               - 凭证由 lark-cli 自己用 OS keychain 管，OOC 不存 secret，无需 stone 落盘。
               - 群 / 文档身份不上升为 OOC Object，只作为 Window 实例存在；多个 thread 可并行打开同一 chat_id 但各自持有独立 buffer。
               - 代价：跨 session 的"该群上次看到哪条消息"等沉淀目前无处落（每个 window 实例各自的 cursor/buffer 是 flow 级，session 结束即丢）。如果未来需要持久化 cursor / 共享配额监控，再回升级为 Adapter Object。

            2. **send / reply 默认 \`--as bot\`** — 隔离风险，行为可观测，与个人账号操作分离。
               需要个人身份时显式 \`args.as="user"\`（带权限风险提示）。
               其它读类命令（refresh / search / read / search_in_doc）默认 \`--as user\`，因为飞书搜索类 scope 通常只对 user 开放。

            3. **写类命令强制 dry-run gate** — 包括 chat.send / chat.reply / doc.append / doc.patch_block / doc.attach_to_chat。
               首次 submit 只走 \`lark-cli --dry-run\` 预览；refine \`args.confirm=true\` 后再 submit 才真正下发。
               理由：飞书消息 / 文档的撤销成本（社交语义 / 文档版本）高于多走一轮 form。

            4. **patch_block 强制 expected_version** — confirm 提交时必须传入与当前 \`window.versionId\` 一致的 expected_version；
               不一致即拒绝，要求重 read。理由：飞书文档可能被他人在两次 dry-run/confirm 之间改动。

            5. **subscribe 当前仅写意愿** — 不接 poller。理由：lark-cli 没有暴露 webhook / event-stream，
               真正的轮询调度涉及 worker / scheduler 改造，本期不做；写字段以备 future poller 拉起。
            `,
        },

        single_vs_two_layer: {
            title: "单层 Window vs 两层（Window + Adapter Object）的边界",
            content: `
            设计方案讨论时存在两种形态：
            - **两层**：建 \`agent_of_feishu\` stone（凭证元数据 / 配额 / scope 白名单 / lark-cli helper）
              + Window type 引用 helper。
            - **单层**：直接把 helper 放 \`src/executable/windows/_shared/lark-cli.ts\`，Window type
              直接调；不建 stone。

            最终采用**单层**（supervisor §decisions.1）。判断标准与 cookbook.add-new-agent §when_to_say_no
            一致：当前需求里 Adapter Object 给不出独立的"长期身份与设计源码"——它没有自己的
            self.md（"我是 OOC 与飞书租户的领事馆"读起来像基础设施而非 Agent），没有跨 session
            的有意义 sediment（凭证 lark-cli 已经管），也没有被其它 Agent 频繁 talk_window 的需求。

            **何时升级到两层**：
            - 出现配额监控 / 调用计数 / 失败率沉淀的具体需求 → 应该有一个 Object 持有这些 sediment。
            - 多 Agent 通过 talk_window 协商飞书消息策略（何时发、用谁的身份）→ 那个协调者就是 Adapter Object。
            - 希望把"飞书 OAuth 状态可视化"放进 web 控制面 → 通过 Object 的 client/index.tsx 实现。

            目前都没出现。保持单层，避免过早抽象。
            `,
        },

        windows: {
            title: "feishu_chat / feishu_doc Window 的 command 分布",
            content: `
            两个 Window type 的 command 表（详细 KNOWLEDGE 见 src 内的 \`*_KNOWLEDGE\` 常量）：

            **feishu_chat_window**:
            | command | 副作用 | dry-run gate | 默认身份 |
            |---|---|---|---|
            | refresh | 无（仅本地 buffer 更新） | — | user |
            | search | 无 | — | user |
            | send | **有** | **强制** | bot |
            | reply | **有** | **强制** | bot |
            | subscribe | 仅本地字段 | — | — |
            | close | 仅释放 window | — | — |

            **feishu_doc_window**:
            | command | 副作用 | dry-run gate | 默认身份 |
            |---|---|---|---|
            | read | 无（覆盖 window.content） | — | user |
            | search_in_doc | 无（在本地 content 内查） | — | — |
            | append | **有** | **强制** | user |
            | patch_block | **有** | **强制 + expected_version 检查** | user |
            | share_link | 无（派生 URL） | — | — |
            | attach_to_chat | **有**（发链接到群） | **强制** | bot |
            | close | 仅释放 window | — | — |

            **打开 Window 的入口**（root commands）：
            - \`open_feishu_chat\` — 给 chat_id 即建 window，不立即 refresh；建议第一步 refresh 验证拉取链路。
            - \`open_feishu_doc\` — 给 doc_token 即建 window，不立即 read；建议第一步 read 验证。

            "不立即拉取"是有意为之：让 lark-cli 鉴权失败 / 网络异常以"明确的 refresh / read 失败"出现，
            而不是被 open 命令的副作用淹没。
            `,
        },

        dry_run_implementation: {
            title: "强制 dry-run gate 的实现细节",
            content: `
            dry-run gate 在 command 实现里通过两个 args 字段驱动：

            1. \`args.confirm: boolean\` — 必须 \`=== true\` 才真发。
            2. command.match() 在 confirm=true 时追加一条 path（如 \`["send", "send.confirmed"]\`）；
               这条额外 path 用于 knowledge 层判别"已确认 vs 未确认"，但当前实现尚未挂额外知识激活
               规则（见 §future.confirmed_path_knowledge）。
            3. command.knowledge() 在 \`formStatus === "open" && args.confirm !== true\` 时
               追加 \`*_DRY_RUN_REQUIRED\` 知识条目，提示 LLM 当前必须先 dry-run。

            exec 流程：
            - 首次 submit（confirm 缺省）：调 \`larkExec(args, { dryRun: true })\`，把 lark-cli 的预览
              输出截断后写回 form result。form 状态切到 executed 但保留打开（LLM 看到预览）。
            - LLM 看完 → \`refine(form_id, args={ confirm: true })\` → 再次 \`submit\`：调 \`larkExec(args)\`
              真正下发；成功后 form 自动关闭。

            **为什么不让 dry-run 自动连提交真发**：
            两步制让 LLM（或人类回看 debug 时）有一个明确的"看 → 想 → 确认"间隙；自动连发等于
            把 dry-run 变成了普通副作用预览，失去 gate 价值。
            `,
        },

        risks: {
            title: "已知风险与 lark-cli 假设",
            content: `
            实施时对 lark-cli 行为做了以下假设；2026-05-25 凭证就绪后已实跑核对，下方备注每条的实际结果。

            1. **\`--format json\` 输出 schema** — \`normalizeMessages\` / pickDocument 走宽容解析。
               实测：\`docs +fetch --api-version v2 --doc <token> --doc-format markdown\` 返回 \`{ ok, identity, data: { document: { content, document_id, revision_id } } }\`，已对齐 \`pickDocument\`。
               \`im +chat-messages-list\` / \`im +messages-search\` 返回 \`{ data: { items: [...] } }\`，与 \`extractItemsArray\` 兼容。

            2. **子命令名** — 上一版本基于 README 推断，本期实测后修正到位（feishu_chat 与 feishu_doc 两类 cliArgs 拼装）：
               - feishu_chat.refresh：~~\`im +messages-list\`~~ → **\`im +chat-messages-list\`**（带 chat- 前缀）
               - feishu_chat.search：~~"messages-list + 客户端过滤"~~ → **\`im +messages-search --query <q> --chat-id <chat>\`**（cli 已有原生 search）
               - feishu_chat.send / reply：\`im +messages-send\` / \`im +messages-reply\` ✓ 一致
               - feishu_doc.read：~~\`markdown +fetch --token\`~~ / ~~\`docs +read --token --include-blocks\`~~ → **\`docs +fetch --api-version v2 --doc <token> [--doc-format markdown | --detail with-ids]\`**
               - feishu_doc.append：~~\`markdown +patch --mode append\`~~ → **\`docs +update --api-version v2 --doc <token> --command append --doc-format markdown --content <text>\`**
               - feishu_doc.patch_block：~~\`docs +patch-block --op replace_text/insert_after/delete\`~~ → **\`docs +update --api-version v2 --doc <token> --command block_replace|block_insert_after|block_delete --block-id <bid>\`**

            3. **\`--format json\` 不能盲传** — lark-cli 的 mutation 命令（\`im +messages-send\` / \`docs +update\` 等）不接受 \`--format\` flag。
               原 \`larkExec\` 无条件附加 \`--format json\` 会让所有写命令报 \`unknown flag: --format\`。
               修复：去掉显式 \`--format json\`；lark-cli 默认输出已是 JSON（见 read 类 \`--format string ... (default "json")\`）。

            4. **high-risk-write 门禁（exit 10）** — lark-cli 对 \`risk: "high-risk-write"\` 的写命令要求显式 \`--yes\`，否则 exit 10。
               见 lark-shared SKILL.md。
               修复：所有 confirm=true 的真正下发分支调用 \`larkExec([...cliArgs, "--yes"], ...)\`；dry-run 路径不需要 \`--yes\`，因为 \`--dry-run\` 不触发门禁，只打印请求详情。

            5. **\`--page-limit\` vs \`--page-size\`** — list 类命令两套 flag 混用：\`im +chat-messages-list\` 用 \`--page-limit\`（OOC 期望条数），\`im +chat-list\` 用 \`--page-size\`（页大小）。
               feishu_chat.refresh 已对齐 \`--page-limit\`；其它 list 调用如果新增需逐一核对 help。

            6. **share_link 域名硬编码** — 私有部署 / 国际版的链接形态不同。
               实测租户 \`bytedance.sg.larkoffice.com\` 的 docx 文档可被 \`docs +fetch\` 拉取，但本 case 当前的 \`executeShareLink\` 仍硬编码 \`https://feishu.cn/<kind>/<token>\`，国际版用户拿到的链接会 404。
               TODO：改走 lark-cli \`docs +share\` 或读取 \`window.docToken\` 派生的真实租户域名。

            7. **buffer 增量去重按 message_id** — 飞书 OAPI 约定全局唯一，未发现冲突；保持现状。
            `,
        },

        future: {
            title: "未来工作（不在本期范围）",
            content: `
            按 supervisor "其余决策自由判断" 的允许，这些都明确推迟：

            1. **subscribe 通过 \`lark-cli event consume\` 接通**（关键升级，废弃旧"轮询"叙事）：
               原计划走 worker 周期 refresh，是因为以为 lark-cli 没暴露事件流。
               实际上 lark-cli 已有 \`event consume <EventKey>\` 子命令，输出 NDJSON 事件流（见 lark-event skill），覆盖 IM 消息接收、reactions、群成员变更等。
               真正的 subscribe 实现路径：
               - 由 OOC worker 启动一个 long-running \`lark-cli event consume im.message.receive_v1 --max-events N\` 子进程。
               - 按 NDJSON line 解析；命中 chat_id 在订阅清单（feishu_chat_window.subscribePollIntervalMs>0 的那些）时投递 inbox。
               - 失败重启 / 时间窗 / 进程隔离都由 worker 调度。
               这条路径**比"轮询"成本低（事件驱动而非每分钟拉一次）、比 oapi-sdk-go ws 长连接简单（不需引入 SDK 与凭证二次管理）**。
               作为 worker 子树的独立可交付，应在 \`meta/app.server.doc.ts\` worker 节点下立。

            2. **凭证就绪自检 UI** — 在 web 控制面加"飞书凭证状态"卡片，跑 \`auth status\` 透传结果。
               当前体验路径是用户在终端跑 \`lark-cli auth status\`。

            3. **confirmed path 激活差异化知识** — \`send.confirmed\` / \`append.confirmed\` / \`patch_block.confirmed\` 等 path 已经在 command.match() 输出，
               但还没挂额外知识（如"text 长度超 4096 时警示"、"patch_block 在 docx 与 docs v1 行为差异"）。
               作为 reflectable 沉淀的安全网，第二期补。

            4. **富文本 / 卡片 / 文件 send** — 当前 send 仅支持纯文本。
               \`im +messages-send\` 已支持 \`--markdown\` / \`--image\` / \`--file\` 等 flag（见 \`messages-send --help\`），
               未来扩成 feishu_chat.send_markdown / send_card / send_file 单独 command，或在 send 现有 args 上加 mode 字段。

            5. **多租户 / 多账号** — 当前 lark-cli 单实例 = 单凭证；多租户切换涉及 \`auth list\` 与 \`--profile\` 透传，\`larkExec\` 还没做。
            `,
            todo: [
                "subscribe 接通 lark-event consume 子进程（涉及 app.server worker）",
                "confirmed path 加差异化知识，作为 dry-run gate 的最后一道安全网",
                "share_link 走 lark-cli docs +share 而非硬编码 feishu.cn 域名",
                "send 扩展富文本 / 卡片 / 文件 mode（lark-cli 已支持，OOC 包装 TODO）",
            ],
        },

        sdk_vs_cli: {
            title: "SDK 路径 vs CLI 子进程路径的取舍（2026-05-25 评估）",
            content: `
            用户提供的飞书内部文档 \`https://bytedance.sg.larkoffice.com/docx/XFjbdz559oqFTkxWRAglVrp2gng\` 演示了
            **基于 \`github.com/larksuite/oapi-sdk-go/v3\` + ws 长连接 + eino + MCP** 搭建飞书 AI 机器人的端到端方案。
            它代表了"SDK 路径"——直接拿 appID/appSecret 初始化 client，注册 OnP2MessageReceiveV1 等 event handler，
            通过 \`client.Im.Message.Create\` / \`client.Im.Message.Reply\` 发消息。

            这套方案对 OOC 的诱惑：
            1. 真长连接事件订阅，毫秒级延迟（无 cli 子进程 cold start）。
            2. Builder API 类型安全，IDE 能补全 ReceiveIdTypeChatId / MsgTypeText 等枚举。
            3. 适合"做飞书机器人"这种端到端场景。

            **OOC 不走这条路**，原因：
            1. **目的错位** — OOC 不想做飞书机器人；想"把飞书塞进 OOC 的 LLM context"。前者 SDK 路径是端到端，后者只需要"打开窗口 → 拉消息 / 发消息"的同步语义，CLI 已经够。
            2. **运行时不匹配** — 文档示例是 Go SDK；OOC 是 TS / bun。要走 SDK 必须引入 \`@larksuite/oapi-sdk-nodejs\`（社区维护，不如 lark-cli 紧跟 OAPI 节奏），或自己用 fetch 调 OAPI（重新发明 lark-cli 已经做完的鉴权 / scope 检查 / dry-run）。
            3. **凭证管理重复** — lark-cli 已经把 appID/appSecret 放 OS keychain；引入 SDK 需要在 OOC 自己再存一份（违反 supervisor §decisions.1 "OOC 不复制存储 secret"）。
            4. **subscribe 不需要 ws** — 上文 §future.1 已经发现 \`lark-cli event consume\` 输出 NDJSON 事件流，覆盖了 SDK 主要场景（OnP2MessageReceiveV1 / OnReactionCreated 等）。子进程比 ws 简单（不用 OOC 自己管心跳 / 重连 / 凭证刷新），延迟够用（消息事件本身就是异步的）。
            5. **dry-run / scope 检查 / device-code login** — lark-cli 已经包好这些工程；SDK 路径要么自己重写，要么放弃这些保护。

            **结论**：保留 CLI 子进程路径作为飞书集成的唯一通道。
            未来如果遇到 lark-cli 解决不了的瓶颈（具体例：事件吞吐 > 10/s 让子进程堆积、或某些 OAPI 不被 cli 包），再单点突破而不是整体迁移。
            那时也优先选 \`lark-cli api POST /path\`（raw API 子进程，覆盖 2500+ 端点），而不是引入 SDK。
            `,
            named: {
                "oapi-sdk-go": "github.com/larksuite/oapi-sdk-go/v3, Go 官方 SDK；仅 Go 生态用",
                "ws long polling": "SDK 提供的事件订阅长连接；OOC 用 lark-cli event consume NDJSON 替代",
                "eino / MCP": "用户给的文档同时演示了字节内部 eino 框架接入 LLM + MCP server，这部分与 OOC 自己的 thinkable 维度替代关系；不影响本 case 的飞书集成裁决",
            },
        },

        files: {
            title: "本期落地的文件清单",
            content: `
            **目录结构**（2026-05-25 重构后；lark 相关代码集中于 \`src/extendable/lark/\`）：

            \`\`\`
            src/extendable/
            ├── index.ts                          # 扩展层 barrel；由 windows/index.ts 拉起
            └── lark/
                ├── index.ts                      # lark 子系统 barrel：side-effect 注册 + re-export
                ├── cli.ts                        # larkExec / larkCheckAuth / LarkCliError
                ├── feishu-chat/
                │   ├── types.ts                  # FeishuChatWindow / FeishuChatMessage 接口
                │   ├── index.ts                  # registerWindowType + 6 个 command 实现 + render hook
                │   └── open-command.ts           # root.open_feishu_chat
                └── feishu-doc/
                    ├── types.ts                  # FeishuDocWindow / FeishuDocBlock 接口
                    ├── index.ts                  # registerWindowType + 7 个 command 实现 + render hook
                    └── open-command.ts           # root.open_feishu_doc
            \`\`\`

            **与 OOC core 的接口面**：
            - \`src/executable/windows/_shared/types.ts\` — \`WindowType\` union 含 \`"feishu_chat" | "feishu_doc"\` 字面量；\`ContextWindow\` union 引用从 extendable 路径 re-export 的 FeishuChatWindow / FeishuDocWindow；\`generateWindowId\` 前缀表含两类。
            - \`src/executable/windows/_shared/registry.ts\` — \`REGISTRY.set("feishu_chat" | "feishu_doc", { commands: {} })\` 占位（registerWindowType 要求 type 已存在；这是现有契约，未做更大重构）。
            - \`src/executable/windows/index.ts\` — barrel 末尾 \`import "../../extendable/index.js"\` 拉起所有 extendable 子系统。
            - \`src/executable/windows/root/index.ts\` — 通过 \`extendable/lark\` barrel 拉 \`openFeishuChatCommand\` / \`openFeishuDocCommand\`。

            **未新增**：
            - \`stones/<...>/agent_of_feishu/\` — 按 §decisions.1 不建。
            - 单独的知识 markdown 文件 — 知识全部以 inline string 形式落在各 command 文件的 \`*_KNOWLEDGE\` / \`basicKnowledge\`，符合 OOC 现有 file/talk/program 等 builtin window 的惯例。

            **后续扩展点**：新接外部世界（如 notion、slack、github）按相同模板建 \`src/extendable/<name>/\`，barrel 自注册即可，不需要触碰 \`executable/windows/_shared\`（除非要新增 WindowType 字面量）。
            `,
        },
    },
    warnings: [
        "lark-cli 子命令名已于 2026-05-25 在 bytedance.sg.larkoffice.com 实跑确认（docs +fetch / im +messages-send dry-run / im +chat-list / docs +update append dry-run 全部通过）。后续 lark-cli 升级造成的命令变化以 \`lark-cli <cmd> --help\` 为准。",
        "本 case 不依赖 stone 落盘；如果未来希望飞书 cursor / lastSeenMessageId 持久化跨 session，需要补 Adapter Object 或借用现有 main stone 的 pool 落点。",
        "subscribe 当前仅写字段意愿；真正订阅由 §future.1 的 lark-event consume 子进程方案接通，这是 worker 子树的工作而不是 Window 自身职责。",
    ],
};
