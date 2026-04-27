import { consola } from "consola";

import { ThreadsTree } from "../../thinkable/thread-tree/tree.js";
import { resumeWithThreadTree, type EngineConfig } from "../../thinkable/engine/engine.js";

import type { ContextWindow } from "../../shared/types/index.js";
import type { TalkResult } from "../../thinkable/engine/types.js";

/**
 * 运行一轮 super 线程 ThinkLoop（跨 session 常驻线程的执行入口）
 *
 * super 线程落盘在 `stones/{name}/super/`（非 `flows/{sid}/objects/{name}`），
 * 跨 session 常驻。本函数复用 `resumeWithThreadTree` 的整套 scheduler 管线——
 * 通过 `objectFlowDirOverride` 把 super 目录作为 engine 的工作目录。
 *
 * 为什么复用 resume 而非 run：
 * - super 线程在首次 `handleOnTalkToSuper` 时已经创建 root 线程并写了 inbox
 * - runWithThreadTree 假设"一次 talk 触发一次 run"——会额外写入 incoming message
 * - resumeWithThreadTree 的模型是"拿已有 tree 跑 scheduler"，正符合 super 场景
 *
 * sessionId 传 `super:{stoneName}`——虚拟标签，不对应物理 flows 目录。
 * 仅用于 SSE 事件 / 日志 / onTalk 回调透传。engine 内部不会因此创建新文件。
 *
 * 执行语义：
 * 1. 加载 super 目录的 ThreadsTree
 * 2. 所有 status=running 的线程由 scheduler 并发拉起（复活回调已在 resume 里注入）
 * 3. LLM 消费 inbox、调用 `persist_to_memory` / `create_trait`、mark 掉 unread
 * 4. root 线程完成后返回 done/waiting（scheduler 根据 inbox/子线程状态决定）
 * 5. 下次 tick 时 super-scheduler 检测是否还有 unread，有就再跑一轮
 *
 * 错误处理：engine 内部的异常由 scheduler 捕获并写入 inbox（with from=system）。
 * 本函数只传播"无法加载 tree"这一启动级错误。
 *
 * @param stoneName super 所属的 stone 名
 * @param superDir super 目录绝对路径（由 `getSuperThreadDir` 计算）
 * @param config engine 配置（由 World 层构建，traits 含 `reflective/super` 等）
 */
export async function runSuperThread(
  stoneName: string,
  superDir: string,
  config: EngineConfig,
): Promise<TalkResult> {
  /* 虚拟 sessionId：仅用于日志 / SSE / onTalk 透传，不对应物理 flows/ 目录 */
  const virtualSessionId = `super:${stoneName}`;

  consola.info(`[Engine] 启动 super 线程 ${stoneName} (dir=${superDir})`);

  /* 关键：super 线程必须激活 `kernel:reflective/super` trait，否则：
   * 1. LLM 不知道自己处于"反思角色"——会按普通对象的 readme 思考（错位）
   * 2. `persist_to_memory` / `create_trait` 方法 trait 不会被普通 command 自动展示正文，
   *    不显式激活就不会出现在沙箱 callMethod 列表里——LLM 无法调用沉淀工具
   *
   * 做法：load tree → 在 root 线程的 activatedTraits 注入 `kernel:reflective/super`
   * （tree.activateTrait 内部幂等，已激活则 noop）。 */
  const tree = ThreadsTree.load(superDir);
  if (!tree) {
    throw new Error(`无法加载 super 线程树: ${superDir}`);
  }
  await tree.activateTrait(tree.rootId, "kernel:reflective/super");

  /* 注入 super 角色 prompt 到 extraWindows——LLM 在 Context 看到「我是 X 的 super 镜像分身」
   *
   * 含完整 open + refine + submit 的工具调用示例——program trait/method 的 open 必须传 trait
   * 和 method 两个参数，缺失会导致 submit 时 engine 报错（这是常见陷阱）。 */
  const superPromptWindow: ContextWindow = {
    name: "super_role",
    content: [
      `你现在处于 **${stoneName}:super 线程**——你是 ${stoneName} 的反思镜像分身（super-ego）。`,
      "",
      "你的职责：消化 inbox 中的经验候选条目，决定哪些值得**沉淀**到长期记忆。",
      "",
      "## 可用沉淀工具（已自动加载 `kernel:reflective/super` trait）",
      "",
      "- `persist_to_memory({ key, content })` — 追加经验到 `stones/{name}/memory.md`（长期记忆）",
      "- `create_trait({ relativePath, content })` — 固化「做法」为新 trait（可选，更重的沉淀）",
      "",
      "## 典型工作流程（每条 unread inbox 消息）",
      "",
      "1. 读 inbox 消息（来自主线程的「经验候选」）",
      "2. 判断是否值得沉淀（重复/琐碎的就 mark 为 ignore）",
      "3. 值得沉淀 → open + refine + submit program trait/method 调 `persist_to_memory`",
      "4. 用 mark 把消息状态从 unread 改为 ack（type: ack, tip: 已沉淀/已忽略）",
      "5. 没有更多消息要处理时 → open + submit `return` 结束本轮",
      "   （线程进入 done，下次有新消息会自动复活）",
      "",
      "## 完整工具调用示例（最关键！）",
      "",
      "**第一步：open 必须传 `trait` + `method` 两个参数**：",
      "```json",
      "open({",
      '  "title": "沉淀经验",',
      '  "type": "command",',
      '  "command": "program",',
      '  "trait": "kernel:reflective/super",   // <-- 必传，完整 traitId',
      '  "method": "persist_to_memory",        // <-- 必传',
      '  "description": "沉淀经验到 memory.md"',
      "})",
      "```",
      "",
      "**第二步：用 refine 在 `args` 字段下传方法参数**：",
      "```json",
      "refine({",
      '  "form_id": "f_xxx",                   // 从 open 返回',
      '  "args": {                              // <-- 方法参数整体放这里',
      '    "key": "线程树的认知透明度价值",',
      '    "content": "完整经验描述..."',
      '  }',
      "})",
      "```",
      "",
      "**第三步：submit 执行，并可同时 mark inbox 消息**：",
      "```json",
      "submit({",
      '  "form_id": "f_xxx",',
      '  "mark": [{ "messageId": "msg_xxx", "type": "ack", "tip": "已沉淀" }]',
      "})",
      "```",
      "",
      "**常见错误**：open 只传 `description` 但漏了 `trait` / `method`——",
      "engine 会报错 \"program trait/method 缺少 trait 或 method 参数\"。",
      "",
      `## 边界提醒：你不是普通的 ${stoneName}`,
      "",
      "- 不要去执行任务、不要去查文档资料、不要去回答用户",
      "- 你只做一件事：消化 inbox + 选择性沉淀",
      "- 所有外部工作由主线程完成——super 是内省分身",
    ].join("\n"),
  };

  const augmentedConfig: EngineConfig = {
    ...config,
    extraWindows: [
      ...(config.extraWindows ?? []),
      superPromptWindow,
    ],
  };

  /* 复用 resume 路径——关键是把 objectFlowDir 指向 super 目录而非 flows/ */
  return resumeWithThreadTree(
    stoneName,
    virtualSessionId,
    augmentedConfig,
    /* modifiedOutput */ undefined,
    /* objectFlowDirOverride */ superDir,
  );
}
