/**
 * World —— OOC 系统的根对象 (G7, G8)
 *
 * World 是 OOC 的根对象，它管理所有其他对象。
 * World 不是「生态中的一个对象」，而是「生态本身」。
 * 但它仍然遵循 G1——它有 readme.md、data.json，它是一个 OOC Object。
 *
 * @ref docs/哲学文档/gene.md#G1 — implements — World 本身也是对象
 * @ref docs/哲学文档/gene.md#G7 — implements — .ooc/ 目录即 World 的物理存在
 * @ref docs/哲学文档/gene.md#G8 — implements — 消息投递（talk/talkInSpace）、对象创建
 * @ref src/world/registry.ts — references — Registry 对象注册表
 * @ref src/world/router.ts — references — CollaborationAPI 消息路由
 * @ref src/world/session.ts — references — Session 任务会话
 * @ref src/world/scheduler.ts — references — Scheduler 多 Flow 调度
 */

import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { consola } from "consola";
import { Registry } from "./registry.js";
import { createCollaborationAPI, createSharedRoundCounter, type Routable, type SharedRoundCounter } from "./router.js";
import { Session } from "./session.js";
import { Scheduler } from "./scheduler.js";
import { CronManager } from "./cron.js";
import { Stone } from "../stone/index.js";
import { Flow } from "../flow/index.js";
import { loadAllTraits, loadTraitsByRef } from "../trait/index.js";
import { OpenAICompatibleClient, type LLMClient } from "../thinkable/client.js";
import { DefaultConfig, type LLMConfig } from "../thinkable/config.js";
import { emitSSE } from "../server/events.js";

/** World 配置 */
export interface WorldConfig {
  /** user repo 根目录路径 */
  rootDir: string;
  /** LLM 配置（可选，默认使用 DefaultConfig） */
  llmConfig?: LLMConfig;
}

/** World 实例 —— 实现 Routable 接口支持对象间协作 */
export class World implements Routable {
  /** user repo 根目录 */
  private readonly _rootDir: string;
  /** 对象注册表 */
  private readonly _registry: Registry;
  /** LLM 客户端 */
  private readonly _llm: LLMClient;
  /** 活跃的 session 上下文（支持并发，key = mainFlow.sessionId） */
  private readonly _activeSessions = new Map<string, {
    session: Session;
    scheduler: Scheduler;
    roundCounter: SharedRoundCounter;
    traitsCache: Map<string, import("../types/index.js").TraitDefinition[]>;
  }>();
  /** 暂停请求集合（运行时状态，不持久化） */
  private readonly _pauseRequests = new Set<string>();
  /** 定时任务管理器 */
  private _cron: CronManager;

  constructor(config: WorldConfig) {
    this._rootDir = config.rootDir;
    this._registry = new Registry(join(config.rootDir, "stones"));
    this._llm = new OpenAICompatibleClient(config.llmConfig ?? DefaultConfig());
    this._cron = new CronManager((task) => {
      this.talk(task.targetObject, task.message, `cron:${task.createdBy}`).catch(err => {
        consola.error(`[Cron] 定时任务 ${task.id} 执行失败:`, err);
      });
    });
  }

  /* ========== 初始化 ========== */

  /**
   * 初始化 World 目录结构
   *
   * 如果 user repo 根目录结构不存在，创建完整的目录结构。
   * 如果已存在，加载所有对象。
   */
  init(): void {
    if (!existsSync(this._rootDir)) {
      consola.info("[World] 创建目录结构");
      this._createDirectoryStructure();
    }

    /* 确保 user 对象存在（G1: 人类也是对象） */
    this._ensureUserObject();

    /* 加载所有对象 */
    this._registry.loadAll();
    const count = this._registry.names().length;
    consola.info(`[World] 已加载 ${count} 个对象: ${this._registry.names().join(", ") || "(空)"}`);

    /* 启动定时任务管理器 */
    this._cron.start();

    /* 异步恢复未完成的 session（不阻塞服务器启动） */
    this._autoResumeSessions().catch(e => {
      consola.error("[World] 自动恢复 session 失败:", (e as Error).message);
    });
  }

  /**
   * 确保 user 对象存在
   *
   * user 是 OOC 系统的内置对象，代表人类用户（G1: 万物皆对象）。
   * user 不参与 ThinkLoop——它的「思考」由屏幕前的人类完成。
   */
  private _ensureUserObject(): void {
    const userDir = join(this._rootDir, "stones", "user");
    if (existsSync(userDir)) return;

    consola.info("[World] 创建内置 user 对象");
    mkdirSync(userDir, { recursive: true });

    const readme = [
      "---",
      "whoAmI: OOC 系统的人类用户",
      "functions: []",
      "---",
      "",
      "我是 OOC 系统的人类用户。",
      "我通过前端界面与系统中的对象交互。",
      "我的思考由人类完成，不经过 ThinkLoop。",
      "",
    ].join("\n");

    writeFileSync(join(userDir, "readme.md"), readme, "utf-8");
    writeFileSync(join(userDir, "data.json"), "{}", "utf-8");
  }

  /**
   * 创建初始目录结构
   */
  private _createDirectoryStructure(): void {
    const dirs = [
      this._rootDir,
      join(this._rootDir, "stones"),
      join(this._rootDir, "flows"),
      join(this._rootDir, "kernel"),
      join(this._rootDir, "kernel", "traits"),
      join(this._rootDir, "library"),
      join(this._rootDir, "library", "traits"),
      join(this._rootDir, "library", "skills"),
      join(this._rootDir, "library", "ui-components"),
    ];

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }

    /* World 自己的 readme.md */
    const worldReadme = [
      "---",
      "whoAmI: OOC World — 管理所有对象的根实体",
      "---",
      "",
      "我是 OOC 系统的 World 对象。",
      "我管理系统中所有其他对象的生命周期、通信和协作。",
      "我是生态本身，而非生态中的一个对象。",
      "",
    ].join("\n");

    writeFileSync(join(this._rootDir, "readme.md"), worldReadme, "utf-8");
    writeFileSync(join(this._rootDir, "data.json"), "{}", "utf-8");

    /* 创建 kernel traits */
    this._createKernelTraits();
  }

  /**
   * 创建 Kernel Traits
   *
   * 从 kernel/traits/ 目录的实际文件复制。
   * 如果文件已存在则跳过，避免覆盖手动更新的文档。
   */
  private _createKernelTraits(): void {
    const kernelTraitsDir = join(this._rootDir, "kernel", "traits");

    /* computable trait */
    const computableReadme = join(kernelTraitsDir, "computable", "readme.md");
    if (!existsSync(computableReadme)) {
      mkdirSync(join(kernelTraitsDir, "computable"), { recursive: true });
      writeFileSync(
        computableReadme,
        [
          "---",
          "when: always",
          "---",
          "",
          "# 程序执行能力",
          "",
          "你处于一个「思考-执行」循环中。每一轮你可以思考并输出一段代码，系统会执行代码并把结果反馈给你，然后你再思考下一步。",
          "",
          "工作方式：",
          "1. 思考当前需要做什么",
          "2. 输出一段代码（放在 ```javascript 代码块中）",
          "3. 系统执行代码，结果会在下一轮思考中通过 print() 输出可见",
          "4. 根据执行结果决定下一步",
          "",
          "重要：每次只输出一段代码，观察结果后再决定下一步。不要试图在一次输出中完成所有事情。",
          "你没有互联网访问能力，不要编造你无法验证的数据。",
          "",
          "## 可用 API",
          "",
          "### 基础",
          "",
          "- `print(...args)` — 输出文本，结果会在下一轮思考中可见",
          "- `getData(key)` — 获取数据（Session 优先，Self 兜底，只读）",
          "- `setData(key, value)` — 写入 Session 数据（当前任务可见，任务结束后消散）",
          "- `getAllData()` — 获取所有数据",
          "",
          "### 记忆",
          "",
          "- `getMemory()` — 读取 Self 长期记忆（只读）",
          "- `getSessionMemory()` — 读取当前 Session 的会话记忆",
          "- `updateSessionMemory(content)` — 更新 Session 会话记忆",
          "- `updateFlowSummary(summary)` — 更新对话摘要（跨对话可见）",
          "- `getFlowSummary()` — 读取当前对话摘要",
          "",
          "### 自我对话（沉淀到 Self）",
          "",
          "- `talkToSelf(message)` — 向 ReflectFlow 发消息，请求沉淀信息到 Self（长期记忆/数据/trait）",
          "",
          "普通 Flow 不能直接写 Self 目录。想把 Session 中的收获沉淀到 Self，唯一的方式是 talkToSelf。",
          "ReflectFlow 会判断信息是否值得保存、保存到哪里，并回复处理结果。",
          "",
          "### 跨对象协作",
          "",
          "- `await talk(targetName, message)` — 向另一个对象发消息并等待回复（异步，必须 await）",
          "",
          "### 局部变量",
          "",
          "- `local.x = value` — 写入当前行为树节点的局部变量（跨轮次持久化）",
          "- `local.x` — 读取当前节点或祖先节点的局部变量",
          "",
          "### 行为树（复杂任务规划）",
          "",
          "- `createPlan(title)` — 创建行为树，返回根节点 ID",
          "- `addStep(parentId, title, deps?)` — 添加子步骤",
          "- `completeStep(nodeId, summary)` — 完成一个步骤并记录摘要",
          "- `moveFocus(nodeId)` — 手动移动注意力到指定节点",
          "- `isPlanComplete()` — 检查行为树是否全部完成",
          "",
          "### Trait（自我定义）",
          "",
          "Trait 是你定义自身的方式：约束行为、定义思考风格、扩展能力、注入知识。",
          "创建/编辑 trait 请直接用文件系统 API 写入 `self_traits_dir` 下的文件，然后调用 `reloadTrait`。",
          "",
          "- `readTrait(name)` — 读取 trait，返回 `{ name, readme, when, code }`",
          "- `listTraits()` — 列出当前对象的所有 trait 名称",
          "- `activateTrait(name)` — 为当前栈帧动态添加 trait（focus 离开时自动失效）",
          "- `reloadTrait(name)` — 热加载 trait（文件修改后调用）",
          "",
          "### Context Window 管理",
          "",
          "- `addWindow(name, content)` — 添加静态文本窗口",
          '- `addWindow(name, { file: "path" })` — 添加文件型窗口',
          '- `addWindow(name, { trait: "traitName", method: "methodName" })` — 添加函数型窗口',
          "- `getWindow(name)` — 获取窗口当前内容",
          "- `editWindow(name, content)` — 更新窗口为静态文本",
          "- `removeWindow(name)` — 移除窗口",
          "- `listWindows()` — 列出所有窗口名称",
          "",
          "## 特殊指令",
          "",
          "- `[finish]` — 标记任务完成。仅在你确认所有工作已完成、不再需要执行任何代码时使用。不要和代码块同时输出。",
          "- `[wait]` — 暂停等待外部输入",
          "- `[break]` — 中断当前程序执行",
          "",
          "## 重要规则",
          "",
          "1. **每段代码是独立的沙箱**：不同代码块之间变量不共享。如果你需要在后续步骤中使用某个值（如节点 ID），请用 `setData(key, value)` 保存，下次用 `getData(key)` 读取",
          "2. **异步函数必须 await**：`talk()` 返回 Promise，必须用 `await` 获取结果",
          "3. **用 print() 输出结果**：程序执行结果只有通过 `print()` 才能在下一轮思考中看到",
          "",
          "## 示例",
          "",
          "```javascript",
          'const name = getData("name");',
          'print(`你好，我是 ${name}`);',
          "```",
          "",
          "```javascript",
          'const reply = await talk("greeter", "你好");',
          "print(reply);",
          "```",
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    /* talkable trait */
    const talkableReadme = join(kernelTraitsDir, "talkable", "readme.md");
    if (!existsSync(talkableReadme)) {
      mkdirSync(join(kernelTraitsDir, "talkable"), { recursive: true });
      writeFileSync(
        talkableReadme,
        [
          "---",
          "when: always",
          "---",
          "",
          "# 通信能力",
          "",
          "你可以与系统中的其他对象进行对话和文件共享。",
          "",
          "## 通讯录",
          "",
          "查看 DIRECTORY 部分可以看到系统中所有其他对象的名称、简介和公开方法。",
          "",
          "## 跨对象对话",
          "",
          "```javascript",
          '// 发送消息（异步投递，不会阻塞等待回复）',
          'await talk("对象名", "你的消息");',
          "",
          '// 收到消息后回复对方',
          'await talk("发送者名", "你的回复内容");',
          "",
          '// 向人类回复',
          'await talk("human", "你的回复内容");',
          "```",
          "",
          "`talk()` 是唯一的通信方式。无论是发起对话、回复消息、还是向人类回复，都必须用 `talk()`。",
          "`print()` 只用于调试输出，不会被任何人看到。",
          "",
          "## 社交原则",
          "",
          "- 只在任务需要时才向其他对象发消息。不要为了社交、寒暄或\"保持联系\"而发消息",
          "- 收到消息时，用 `talk()` 回复对方需要的信息即可，不要主动发起新话题",
          "- 如果你已经完成了当前所有工作，且没有新的任务要做，输出 `[wait]` 等待下一条消息",
          "- 每次 `talk()` 都有成本（消耗对方的思考轮次），请珍惜使用",
          "",
          "## 消息中断与恢复",
          "",
          "当你正在执行任务时，可能会收到其他对象发来的消息。系统会自动：",
          "1. 在你的行为树中创建一个消息处理节点",
          "2. 在待办队列头部插入中断项",
          "3. 将你的 focus 切换到消息处理节点",
          "",
          "你需要做的：",
          "1. 先处理收到的消息（回复或执行相关操作）",
          "2. 用 `completeStep` 完成消息处理节点",
          "3. 待办队列会自动弹出中断项，focus 回到之前的任务",
          "4. 继续你被中断前的工作",
          "",
          "重要：处理完消息后，别忘了继续做之前的事情。待办队列会提醒你接下来该做什么。",
          "",
        ].join("\n"),
        "utf-8",
      );
    }
  }

  /* ========== 对象管理 ========== */

  /**
   * 创建新对象
   *
   * @param name - 对象名称
   * @param whoAmI - 对象的自我描述
   * @returns 创建好的 Stone
   */
  createObject(name: string, whoAmI: string): Stone {
    const dir = join(this._registry.stonesDir, name);
    if (existsSync(dir)) {
      throw new Error(`对象 "${name}" 已存在`);
    }

    const stone = Stone.create(dir, name, whoAmI);
    this._registry.register(stone);
    consola.info(`[World] 创建对象: ${name}`);
    emitSSE({ type: "object:created", name });
    return stone;
  }

  /**
   * 获取对象
   */
  getObject(name: string): Stone | undefined {
    return this._registry.get(name);
  }

  /**
   * 列出所有对象
   */
  listObjects(): Stone[] {
    return this._registry.all();
  }

  /* ========== 消息与任务 ========== */

  /**
   * 向对象发送消息，创建 Flow 并运行 ThinkLoop（人类入口）
   *
   * @param objectName - 目标对象名称
   * @param message - 消息内容
   * @param from - 发送者（默认 "human"）
   * @returns Flow 实例
   */
  async talk(objectName: string, message: string, from: string = "human", flowId?: string): Promise<Flow> {
    /* 如果指定了 flowId，在已有 Flow 上续写 */
    if (flowId) {
      return this._resumeAndRunFlow(objectName, message, from, flowId);
    }
    /* 否则创建新的 Flow */
    const flow = await this._createAndRunFlow(objectName, message, from);
    return flow;
  }

  /* ========== 暂停/恢复 ========== */

  /**
   * 暂停对象执行
   *
   * 设置暂停信号。正在运行的 ThinkLoop 会在下一次 LLM 调用返回后暂停，
   * 暂存 LLM output 但不执行其中的 programs。
   */
  pauseObject(name: string): void {
    const stone = this._registry.get(name);
    if (!stone) throw new Error(`对象 "${name}" 不存在`);
    this._pauseRequests.add(name);
    consola.info(`[World] 暂停对象 ${name}`);
  }

  /**
   * 恢复暂停的 Flow
   *
   * 清除暂停信号，加载暂停的 Flow，重新创建 Scheduler 运行。
   * ThinkLoop 会检测到 _pendingOutput 并跳过 LLM 调用直接执行 programs。
   */
  async resumeFlow(objectName: string, flowId: string): Promise<Flow> {
    this._pauseRequests.delete(objectName);
    return this._resumePausedFlow(objectName, flowId);
  }

  /**
   * 单步执行：运行一轮 ThinkLoop 后自动暂停
   *
   * 如果提供了 modifiedOutput，会替换暂存的 LLM 输出。
   * 执行完一轮后自动设置 debugMode，使 ThinkLoop 在执行完后暂停。
   */
  async stepOnce(objectName: string, flowId: string, modifiedOutput?: string): Promise<Flow> {
    this._pauseRequests.delete(objectName);

    const stone = this._registry.get(objectName);
    if (!stone) throw new Error(`对象 "${objectName}" 不存在`);

    /* 加载目标 Flow */
    const sessionDir = join(this.flowsDir, flowId);
    const userStone = this._registry.get("user");
    let targetFlow: Flow | null = null;

    if (userStone) {
      /* 新结构：session/flows/user/ */
      const mainFlow = Flow.load(join(sessionDir, "flows", "user"));
      if (!mainFlow) {
        /* 兼容旧数据 */
        const oldMain = Flow.load(sessionDir);
        if (oldMain) {
          const subFlowDir = join(sessionDir, "flows", objectName);
          targetFlow = Flow.load(subFlowDir);
          if (!targetFlow && oldMain.stoneName === objectName) {
            targetFlow = oldMain;
          }
        }
      } else {
        const subFlowDir = join(sessionDir, "flows", objectName);
        targetFlow = Flow.load(subFlowDir);
        if (!targetFlow && mainFlow.stoneName === objectName) {
          targetFlow = mainFlow;
        }
      }
    }

    if (!targetFlow) {
      /* 兼容旧数据 */
      targetFlow = Flow.load(sessionDir);
    }

    if (!targetFlow) throw new Error(`Flow "${flowId}" 不存在`);

    /* 设置 debugMode */
    targetFlow.setFlowData("debugMode", true);

    /* 可选：替换暂存的 LLM 输出 */
    if (modifiedOutput !== undefined) {
      targetFlow.setFlowData("_pendingOutput", modifiedOutput);
    }

    targetFlow.save();

    /* 恢复执行 — ThinkLoop 会在一轮执行完毕后因 debugMode 自动暂停 */
    return this._resumePausedFlow(objectName, flowId);
  }

  /**
   * 检查对象是否被暂停
   */
  isObjectPaused(name: string): boolean {
    return this._pauseRequests.has(name);
  }

  /**
   * 投递消息到目标对象（Routable 接口，异步，不运行 ThinkLoop）
   *
   * 消息投递到目标的 pending 队列，由 Scheduler 在下一轮调度时处理。
   * "human" 和 "user" 都指向 user 对象（向后兼容）。
   */
  deliverMessage(targetName: string, message: string, from: string, replyTo?: string, sessionId?: string): void {
    /* 通过 sessionId 定位 session（支持并发） */
    const ctx = sessionId ? this._activeSessions.get(sessionId) : null;
    const session = ctx?.session ?? null;

    /* talk("human", ...) 或 talk("user", ...) — 对象向人类回复 */
    if (targetName === "human" || targetName === "user") {
      if (!session) return;
      const senderFlow = session.getFlow(from);
      if (senderFlow) {
        senderFlow.addMessage({ direction: "out", from, to: "user", content: message });
        consola.info(`[World] ${from} → user: 记录为回复`);
      }
      return;
    }

    const stone = this._registry.get(targetName);
    if (!stone) {
      throw new Error(`对象 "${targetName}" 不存在`);
    }

    if (!session) {
      throw new Error("[World] 没有活跃的 Session");
    }

    /* 复用或创建目标的 Flow */
    let targetFlow = session.getFlow(targetName);
    if (targetFlow) {
      consola.info(`[World] 复用 ${targetName} 的 Flow，投递消息 (from: ${from})`);
    } else {
      /* 在 main flow 的 flows/ 子目录下创建 sub-flow */
      targetFlow = Flow.createSubFlow(session.sessionDir, stone.name, message, from, from);
      session.register(targetName, targetFlow);
      /* 注册到 Scheduler */
      const scheduler = ctx?.scheduler;
      if (scheduler) {
        const traitsCache = ctx?.traitsCache;
        const traits = traitsCache?.get(targetName) ?? [];
        const collaboration = createCollaborationAPI(this, targetName, stone.dir, ctx?.roundCounter ?? undefined, targetFlow.sessionId, sessionId);
        scheduler.register(targetName, targetFlow, stone.toJSON(), stone.dir, traits, collaboration);
      }
      consola.info(`[World] 为 ${targetName} 创建 sub-flow ${targetFlow.sessionId} (在 main flow 下)`);
    }

    /* 投递消息到 pending 队列（ThinkLoop 消费时会记录到消息历史和行为树） */
    targetFlow.deliverMessage(from, message, replyTo);
  }

  /**
   * 获取对象目录路径（Routable 接口）
   */
  getObjectDir(name: string): string | null {
    const stone = this._registry.get(name);
    return stone ? stone.dir : null;
  }

  /**
   * 向对象的 ReflectFlow 投递消息（Routable 接口）
   *
   * 普通 Flow 通过 talkToSelf 调用此方法，消息投递到 ReflectFlow 的 pending 队列。
   * ReflectFlow 在下一轮调度时处理。
   */
  deliverToSelfMeta(stoneName: string, message: string, fromTaskId: string): string {
    const stone = this._registry.get(stoneName);
    if (!stone) return `[错误] 对象 "${stoneName}" 不存在`;

    const selfMetaFlow = Flow.ensureReflectFlow(stone.reflectDir, stoneName);
    const taggedMessage = `[from:${fromTaskId}] ${message}`;
    selfMetaFlow.deliverMessage(stoneName, taggedMessage);
    selfMetaFlow.save();

    consola.info(`[World] talkToSelf: ${stoneName}/${fromTaskId} → ReflectFlow`);
    return `[消息已发送给 ReflectFlow]`;
  }

  /**
   * ReflectFlow 回复发起对话的 Flow（Routable 接口）
   *
   * ReflectFlow 通过 replyToFlow 调用此方法，消息投递到目标 Flow 的 pending 队列。
   */
  deliverFromSelfMeta(stoneName: string, targetTaskId: string, message: string, sessionId?: string): string {
    const stone = this._registry.get(stoneName);
    if (!stone) return `[错误] 对象 "${stoneName}" 不存在`;

    /* 通过 sessionId 定位 session（支持并发） */
    const ctx = sessionId ? this._activeSessions.get(sessionId) : null;
    const session = ctx?.session ?? null;
    if (!session) return `[错误] 没有活跃的 Session`;

    /* 遍历 session 中的所有 Flow，找到匹配 taskId 的 */
    for (const { flow } of session.allFlows()) {
      if (flow.sessionId === targetTaskId) {
        flow.deliverMessage("_reflect", `[ReflectFlow 回复] ${message}`);
        consola.info(`[World] ReflectFlow → ${stoneName}/${targetTaskId}`);
        return `[回复已发送给 ${targetTaskId}]`;
      }
    }

    return `[错误] 找不到 Flow "${targetTaskId}"`;
  }

  /**
   * 内部：创建 Flow、Session 并通过 Scheduler 运行
   */
  private async _createAndRunFlow(
    objectName: string,
    message: string,
    from: string,
  ): Promise<Flow> {
    const stone = this._registry.get(objectName);
    if (!stone) {
      throw new Error(`对象 "${objectName}" 不存在`);
    }

    let mainFlow: Flow;
    let targetFlow: Flow;

    if (from === "human") {
      /* 人类发起：main flow 在 flows/ 下，目标对象作为 sub-flow */
      const userStone = this._registry.get("user");
      if (!userStone) throw new Error("user 对象不存在");

      mainFlow = Flow.create(this.flowsDir, "user", message, "human");
      targetFlow = Flow.createSubFlow(mainFlow.sessionDir, stone.name, message, "human", "human");
      /* 写入初始消息到 sub-flow 的 messages[]（createSubFlow 不写入，避免与 deliverMessage 路径重复） */
      targetFlow.addMessage({ direction: "in", from, to: stone.name, content: message });
      targetFlow.save();
      consola.info(`[World] 人类发起对话 → main flow ${mainFlow.sessionId}, sub-flow ${targetFlow.sessionId} (${objectName})`);
    } else {
      /* 非人类发起（系统内部）：直接在 flows/ 下创建 */
      mainFlow = Flow.create(this.flowsDir, stone.name, message, from);
      targetFlow = mainFlow;
      consola.info(`[World] 向 ${objectName} 发送消息，创建 Flow ${mainFlow.sessionId}`);
    }

    emitSSE({ type: "flow:start", objectName, taskId: mainFlow.sessionId });

    /* 创建 SessionContext（支持并发） */
    const sessionId = mainFlow.sessionId;
    const session = new Session(mainFlow.sessionId, mainFlow.sessionDir);
    const roundCounter = createSharedRoundCounter();
    const traitsCache = new Map<string, import("../types/index.js").TraitDefinition[]>();
    if (from === "human") {
      session.register("user", mainFlow);
    }
    session.register(objectName, targetFlow);

    /* 加载 Traits 并缓存 */
    const traits = await this._loadTraits(stone);
    traitsCache.set(objectName, traits);

    /* 预加载所有对象的 traits（Scheduler 创建 sub-flow 时需要） */
    for (const otherStone of this._registry.all()) {
      if (otherStone.name !== objectName && !traitsCache.has(otherStone.name)) {
        const otherTraits = await this._loadTraits(otherStone);
        traitsCache.set(otherStone.name, otherTraits);
      }
    }

    /* 确保目标对象的 ReflectFlow 存在 */
    this._ensureReflectFlow(stone, session);

    /* 构建协作 API */
    const collaboration = createCollaborationAPI(this, objectName, stone.dir, roundCounter, targetFlow.sessionId, sessionId);
    const directory = this._registry.buildDirectory();

    /* 创建 Scheduler 并注册入口 Flow */
    const scheduler = new Scheduler(this._llm, directory, undefined, (name) => this._pauseRequests.has(name), this._cron, this.flowsDir);
    scheduler.register(objectName, targetFlow, stone.toJSON(), stone.dir, traits, collaboration);

    /* 注册到 activeSessions（在 Scheduler.run 之前，deliverMessage 需要访问） */
    this._activeSessions.set(sessionId, { session, scheduler, roundCounter, traitsCache });

    try {
      /* 运行 Scheduler */
      const updatedData = await scheduler.run(objectName);

      /* 同步所有参与对象的数据 */
      for (const { stoneName, flow: f } of session.allFlows()) {
        const s = this._registry.get(stoneName);
        if (s) {
          s.save();
        }
      }

      /* 同步入口对象数据（保留接口兼容，ReflectFlow 机制下普通 Flow 不再直接写 Stone） */
      for (const [key, value] of Object.entries(updatedData)) {
        stone.setData(key, value);
      }
      stone.save();

      /* 同步 main flow 状态（当 main flow 和 target flow 分离时） */
      if (mainFlow !== targetFlow) {
        mainFlow.setStatus(targetFlow.status);
        mainFlow.save();
      }

      /* 发出 Flow 结束事件 */
      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: targetFlow.status });
    } catch (e) {
      /* 异常时将所有 running 的 flow 标记为 failed，防止僵尸 */
      consola.error(`[World] _createAndRunFlow 异常:`, (e as Error).message);
      for (const { flow: f } of session.allFlows()) {
        if (f.status === "running") {
          f.setStatus("failed");
          f.recordAction({ type: "thought", content: `[系统异常] ${(e as Error).message}` });
          f.save();
        }
      }
      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: "failed" });
      throw e;
    } finally {
      /* 清理：从 Map 中移除（即使出错也要清理） */
      this._activeSessions.delete(sessionId);
    }

    return from === "human" ? mainFlow : targetFlow;
  }

  /**
   * 内部：在已有 Flow 上续写消息并重新运行 Scheduler
   *
   * 加载已有 Flow，追加新消息，重新创建 Scheduler 运行。
   * 这样对象能看到之前的对话历史，实现真正的多轮对话。
   */
  private async _resumeAndRunFlow(
    objectName: string,
    message: string,
    from: string,
    flowId: string,
  ): Promise<Flow> {
    const stone = this._registry.get(objectName);
    if (!stone) {
      throw new Error(`对象 "${objectName}" 不存在`);
    }

    /* 加载 flow（统一在 flows/{flowId}/ 下） */
    const sessionDir = join(this.flowsDir, flowId);
    let mainFlow: Flow | null = null;
    let targetFlow: Flow | null = null;

    if (from === "human") {
      const userStone = this._registry.get("user");
      if (!userStone) throw new Error("user 对象不存在");
      /* main flow (user) 在 session/flows/user/ */
      mainFlow = Flow.load(join(sessionDir, "flows", "user"));
      if (!mainFlow) {
        /* 兼容旧数据：session 根目录下直接有 data.json */
        mainFlow = Flow.load(sessionDir);
      }
      if (!mainFlow) throw new Error(`Flow "${flowId}" 不存在`);

      /* 加载 sub-flow */
      const subFlowDir = join(sessionDir, "flows", objectName);
      targetFlow = Flow.load(subFlowDir);
      if (!targetFlow) {
        if (mainFlow.stoneName === objectName) {
          targetFlow = mainFlow;
        } else {
          /* 创建新的 sub-flow */
          targetFlow = Flow.createSubFlow(sessionDir, stone.name, message, from, from);
        }
      }
    } else {
      /* 非人类发起：flow 在 session/flows/{stoneName}/ */
      mainFlow = Flow.load(join(sessionDir, "flows", objectName));
      if (!mainFlow) {
        /* 兼容旧数据 */
        mainFlow = Flow.load(sessionDir);
      }
      if (!mainFlow) throw new Error(`Flow "${flowId}" 不存在`);
      targetFlow = mainFlow;
    }

    /* 追加新消息 */
    targetFlow.addMessage({ direction: "in", from, to: objectName, content: message });
    targetFlow.setStatus("running");
    consola.info(`[World] 在 ${objectName} 的 Flow ${targetFlow.sessionId} 上续写消息`);
    emitSSE({ type: "flow:start", objectName, taskId: mainFlow.sessionId });

    /* 创建 SessionContext（支持并发） */
    const sessionId = mainFlow.sessionId;
    const session = new Session(mainFlow.sessionId, sessionDir);
    const roundCounter = createSharedRoundCounter();
    const traitsCache = new Map<string, import("../types/index.js").TraitDefinition[]>();
    if (from === "human" && mainFlow !== targetFlow) {
      session.register("user", mainFlow);
    }
    session.register(objectName, targetFlow);

    /* 恢复已有的 sub-flows */
    this._loadExistingSubFlows(session, sessionDir, objectName);

    /* 加载 Traits 并缓存 */
    const traits = await this._loadTraits(stone);
    traitsCache.set(objectName, traits);

    for (const otherStone of this._registry.all()) {
      if (otherStone.name !== objectName && !traitsCache.has(otherStone.name)) {
        const otherTraits = await this._loadTraits(otherStone);
        traitsCache.set(otherStone.name, otherTraits);
      }
    }

    /* 确保目标对象的 ReflectFlow 存在 */
    this._ensureReflectFlow(stone, session);

    /* 构建协作 API */
    const collaboration = createCollaborationAPI(this, objectName, stone.dir, roundCounter, targetFlow.sessionId, sessionId);
    const directory = this._registry.buildDirectory();

    /* 创建 Scheduler 并注册 Flow */
    const scheduler = new Scheduler(this._llm, directory, undefined, (name) => this._pauseRequests.has(name), this._cron, this.flowsDir);
    scheduler.register(objectName, targetFlow, stone.toJSON(), stone.dir, traits, collaboration);

    /* 注册到 activeSessions */
    this._activeSessions.set(sessionId, { session, scheduler, roundCounter, traitsCache });

    try {
      /* 运行 Scheduler */
      const updatedData = await scheduler.run(objectName);

      /* 同步所有参与对象的数据 */
      for (const { stoneName, flow: f } of session.allFlows()) {
        const s = this._registry.get(stoneName);
        if (s) {
          s.save();
        }
      }

      /* 同步入口对象数据（保留接口兼容，ReflectFlow 机制下普通 Flow 不再直接写 Stone） */
      for (const [key, value] of Object.entries(updatedData)) {
        stone.setData(key, value);
      }
      stone.save();

      /* 同步 main flow 状态 */
      if (mainFlow !== targetFlow) {
        mainFlow.setStatus(targetFlow.status);
        mainFlow.save();
      }

      /* 发出 Flow 结束事件 */
      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: targetFlow.status });
    } catch (e) {
      /* 异常时将所有 running 的 flow 标记为 failed，防止僵尸 */
      consola.error(`[World] _resumeAndRunFlow 异常:`, (e as Error).message);
      for (const { flow: f } of session.allFlows()) {
        if (f.status === "running") {
          f.setStatus("failed");
          f.recordAction({ type: "thought", content: `[系统异常] ${(e as Error).message}` });
          f.save();
        }
      }
      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: "failed" });
      throw e;
    } finally {
      /* 清理 */
      this._activeSessions.delete(sessionId);
    }

    return mainFlow;
  }

  /**
   * 内部：恢复暂停的 Flow
   *
   * 加载 pausing 状态的 Flow，设为 running，重新创建 Scheduler 运行。
   * ThinkLoop 会检测到 _pendingOutput 并跳过 LLM 调用直接执行 programs。
   */
  private async _resumePausedFlow(
    objectName: string,
    flowId: string,
  ): Promise<Flow> {
    const stone = this._registry.get(objectName);
    if (!stone) {
      throw new Error(`对象 "${objectName}" 不存在`);
    }

    /* 尝试从 flows/ 加载 flow */
    const sessionDir = join(this.flowsDir, flowId);
    const userStone = this._registry.get("user");
    let mainFlow: Flow | null = null;
    let targetFlow: Flow | null = null;

    if (userStone) {
      /* 新结构：session/flows/user/ */
      mainFlow = Flow.load(join(sessionDir, "flows", "user"));
      if (!mainFlow) {
        /* 兼容旧数据：session 根目录 */
        mainFlow = Flow.load(sessionDir);
      }
      if (mainFlow) {
        const subFlowDir = join(sessionDir, "flows", objectName);
        targetFlow = Flow.load(subFlowDir);
        if (!targetFlow && mainFlow.stoneName === objectName) {
          targetFlow = mainFlow;
        }
      }
    }

    /* 兼容旧数据：从 session 根目录加载 */
    if (!mainFlow) {
      mainFlow = Flow.load(sessionDir);
      targetFlow = mainFlow;
    }

    if (!mainFlow || !targetFlow) {
      throw new Error(`Flow "${flowId}" 不存在。提示：flowId 应为主任务 ID（如 task_xxx），不是子 flow ID（如 sub_xxx）`);
    }
    if (targetFlow.status !== "pausing") {
      throw new Error(`Flow "${flowId}" 状态为 "${targetFlow.status}"，不是 pausing`);
    }

    targetFlow.setStatus("running");
    consola.info(`[World] 恢复 ${objectName} 的 Flow ${targetFlow.sessionId}`);
    emitSSE({ type: "flow:start", objectName, taskId: mainFlow.sessionId });

    /* 创建 SessionContext（支持并发） */
    const sessionId = mainFlow.sessionId;
    const session = new Session(mainFlow.sessionId, sessionDir);
    const roundCounter = createSharedRoundCounter();
    const traitsCache = new Map<string, import("../types/index.js").TraitDefinition[]>();
    if (mainFlow !== targetFlow) {
      session.register("user", mainFlow);
    }
    session.register(objectName, targetFlow);

    /* 恢复已有的 sub-flows */
    this._loadExistingSubFlows(session, sessionDir, objectName);

    /* 加载 Traits 并缓存 */
    const traits = await this._loadTraits(stone);
    traitsCache.set(objectName, traits);

    for (const otherStone of this._registry.all()) {
      if (otherStone.name !== objectName && !traitsCache.has(otherStone.name)) {
        const otherTraits = await this._loadTraits(otherStone);
        traitsCache.set(otherStone.name, otherTraits);
      }
    }

    /* 确保目标对象的 ReflectFlow 存在 */
    this._ensureReflectFlow(stone, session);

    /* 构建协作 API */
    const collaboration = createCollaborationAPI(this, objectName, stone.dir, roundCounter, targetFlow.sessionId, sessionId);
    const directory = this._registry.buildDirectory();

    /* 创建 Scheduler 并注册 Flow */
    const scheduler = new Scheduler(this._llm, directory, undefined, (name) => this._pauseRequests.has(name), this._cron, this.flowsDir);
    scheduler.register(objectName, targetFlow, stone.toJSON(), stone.dir, traits, collaboration);

    /* 注册到 activeSessions */
    this._activeSessions.set(sessionId, { session, scheduler, roundCounter, traitsCache });

    try {
      /* 运行 Scheduler */
      const updatedData = await scheduler.run(objectName);

      /* 同步所有参与对象的数据 */
      for (const { stoneName, flow: f } of session.allFlows()) {
        const s = this._registry.get(stoneName);
        if (s) {
          s.save();
        }
      }

      for (const [key, value] of Object.entries(updatedData)) {
        stone.setData(key, value);
      }
      stone.save();

      /* 同步 main flow 状态 */
      if (mainFlow !== targetFlow) {
        mainFlow.setStatus(targetFlow.status);
        mainFlow.save();
      }

      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: targetFlow.status });
    } catch (e) {
      /* 异常时将所有 running 的 flow 标记为 failed，防止僵尸 */
      consola.error(`[World] _resumePausedFlow 异常:`, (e as Error).message);
      for (const { flow: f } of session.allFlows()) {
        if (f.status === "running") {
          f.setStatus("failed");
          f.recordAction({ type: "thought", content: `[系统异常] ${(e as Error).message}` });
          f.save();
        }
      }
      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: "failed" });
      throw e;
    } finally {
      /* 清理 */
      this._activeSessions.delete(sessionId);
    }

    return mainFlow;
  }

  /**
   * 加载对象的 Traits（kernel → library → 对象自身）
   *
   * 【设计变更】library traits 不再自动激活 readme 到 context。
   * 方法始终全量注册，对象通过 activateTrait() 动态激活 readme 到当前栈帧。
   *
   * 合并优先级：kernel → library → object（后者覆盖前者）
   */
  private async _loadTraits(stone: Stone) {
    const kernelTraitsDir = join(this._rootDir, "kernel", "traits");
    const libraryTraitsDir = join(this._rootDir, "library", "traits");
    const objectTraitsDir = join(stone.dir, "traits");

    /* 三层加载：kernel（基座）→ library（公共库）→ object（自定义） */
    const result = await loadAllTraits(objectTraitsDir, kernelTraitsDir, libraryTraitsDir);

    consola.info(`[World] 加载 ${result.length} 个 traits: ${result.map(t => t.name).join(", ")}`);
    consola.info(`[World] library traits 方法已全量注册，readme 通过 activateTrait() 按需激活`);
    return result;
  }

  /**
   * 服务启动时自动恢复未完成的 session
   *
   * 扫描 flows/ 目录，找到 running 或 waiting+有消息 的 flow，
   * 创建 Scheduler 恢复调度。不追加新消息。
   */
  private async _autoResumeSessions(): Promise<void> {
    if (!existsSync(this.flowsDir)) return;

    const sessionDirs = readdirSync(this.flowsDir, { withFileTypes: true });
    const toResume: Array<{ sessionDir: string; sessionId: string; objectName: string; mainFlow: Flow; targetFlow: Flow }> = [];

    for (const entry of sessionDirs) {
      if (!entry.isDirectory()) continue;
      const sessionId = entry.name;
      const sessionDir = join(this.flowsDir, sessionId);
      const flowsSubDir = join(sessionDir, "flows");
      if (!existsSync(flowsSubDir)) continue;

      /* 扫描 session 下所有 flow */
      const flowEntries = readdirSync(flowsSubDir, { withFileTypes: true });
      let needsResume = false;
      let entryObjectName: string | null = null;

      for (const fe of flowEntries) {
        if (!fe.isDirectory() || fe.name === "user") continue;
        const flow = Flow.load(join(flowsSubDir, fe.name));
        if (!flow) continue;

        if (flow.status === "running") {
          needsResume = true;
          entryObjectName = fe.name;
          break;
        }
        if (flow.status === "waiting" && flow.hasPendingMessages) {
          needsResume = true;
          entryObjectName = fe.name;
        }
      }

      if (!needsResume || !entryObjectName) continue;

      /* 加载 main flow (user) 和 target flow */
      const mainFlow = Flow.load(join(flowsSubDir, "user"));
      if (!mainFlow) continue;

      const targetFlow = Flow.load(join(flowsSubDir, entryObjectName));
      if (!targetFlow) continue;

      /* 跳过已完成的 session */
      if (targetFlow.status === "finished" || targetFlow.status === "failed") continue;

      toResume.push({ sessionDir, sessionId, objectName: entryObjectName, mainFlow, targetFlow });
    }

    if (toResume.length === 0) return;

    consola.info(`[World] 发现 ${toResume.length} 个未完成的 session，开始恢复`);

    /* 串行恢复，避免同时消耗大量 LLM 配额 */
    for (const { sessionDir, sessionId, objectName, mainFlow, targetFlow } of toResume) {
      try {
        await this._autoResumeSession(sessionDir, sessionId, objectName, mainFlow, targetFlow);
      } catch (e) {
        consola.error(`[World] 恢复 session ${sessionId} 失败:`, (e as Error).message);
      }
    }
  }

  /**
   * 自动恢复单个 session（不追加新消息）
   *
   * 逻辑与 _resumeAndRunFlow 类似，但跳过消息追加步骤。
   */
  private async _autoResumeSession(
    sessionDir: string,
    sessionId: string,
    objectName: string,
    mainFlow: Flow,
    targetFlow: Flow,
  ): Promise<void> {
    const stone = this._registry.get(objectName);
    if (!stone) {
      consola.warn(`[World] 自动恢复跳过: 对象 "${objectName}" 不存在`);
      return;
    }

    /* 设置为 running */
    targetFlow.setStatus("running");
    consola.info(`[World] 自动恢复 session ${sessionId}, 入口对象: ${objectName}`);
    emitSSE({ type: "flow:start", objectName, taskId: mainFlow.sessionId });

    /* 创建 SessionContext */
    const session = new Session(mainFlow.sessionId, sessionDir);
    const roundCounter = createSharedRoundCounter();
    const traitsCache = new Map<string, import("../types/index.js").TraitDefinition[]>();
    if (mainFlow !== targetFlow) {
      session.register("user", mainFlow);
    }
    session.register(objectName, targetFlow);

    /* 恢复已有的 sub-flows */
    this._loadExistingSubFlows(session, sessionDir, objectName);

    /* 加载 Traits 并缓存 */
    const traits = await this._loadTraits(stone);
    traitsCache.set(objectName, traits);

    for (const otherStone of this._registry.all()) {
      if (otherStone.name !== objectName && !traitsCache.has(otherStone.name)) {
        const otherTraits = await this._loadTraits(otherStone);
        traitsCache.set(otherStone.name, otherTraits);
      }
    }

    /* 确保 ReflectFlow 存在 */
    this._ensureReflectFlow(stone, session);

    /* 构建协作 API */
    const collaboration = createCollaborationAPI(this, objectName, stone.dir, roundCounter, targetFlow.sessionId, sessionId);
    const directory = this._registry.buildDirectory();

    /* 创建 Scheduler 并注册 */
    const scheduler = new Scheduler(this._llm, directory, undefined, (name) => this._pauseRequests.has(name), this._cron, this.flowsDir);
    scheduler.register(objectName, targetFlow, stone.toJSON(), stone.dir, traits, collaboration);

    /* 注册到 activeSessions */
    this._activeSessions.set(sessionId, { session, scheduler, roundCounter, traitsCache });

    try {
      const updatedData = await scheduler.run(objectName);

      /* 同步所有参与对象的数据 */
      for (const { stoneName } of session.allFlows()) {
        const s = this._registry.get(stoneName);
        if (s) s.save();
      }

      for (const [key, value] of Object.entries(updatedData)) {
        stone.setData(key, value);
      }
      stone.save();

      /* 同步 main flow 状态 */
      if (mainFlow !== targetFlow) {
        mainFlow.setStatus(targetFlow.status);
        mainFlow.save();
      }

      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: targetFlow.status });
      consola.info(`[World] session ${sessionId} 恢复完成, 状态: ${targetFlow.status}`);
    } catch (e) {
      consola.error(`[World] _autoResumeSession 异常:`, (e as Error).message);
      for (const { flow: f } of session.allFlows()) {
        if (f.status === "running") {
          f.setStatus("failed");
          f.recordAction({ type: "thought", content: `[系统异常] ${(e as Error).message}` });
          f.save();
        }
      }
      emitSSE({ type: "flow:end", objectName, taskId: mainFlow.sessionId, status: "failed" });
    } finally {
      this._activeSessions.delete(sessionId);
    }
  }

  /**
   * 加载 session 下已有的 sub-flows 到 session
   *
   * 恢复对话时，需要把之前创建的 sub-flows 重新注册到 session，
   * 这样 deliverMessage 能正确复用已有的 sub-flow。
   */
  private _loadExistingSubFlows(session: Session, sessionDir: string, excludeName?: string): void {
    const flowsDir = join(sessionDir, "flows");
    if (!existsSync(flowsDir)) return;

    const entries = readdirSync(flowsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const stoneName = entry.name;
      if (stoneName === excludeName) continue;
      if (session.hasFlow(stoneName)) continue;

      const subFlow = Flow.load(join(flowsDir, stoneName));
      if (subFlow) {
        session.register(stoneName, subFlow);
        consola.info(`[World] 恢复 sub-flow: ${stoneName} (${subFlow.sessionId})`);
      }
    }
  }

  /**
   * 确保目标对象的 ReflectFlow 存在并注册到 session/scheduler
   *
   * ReflectFlow 是对象的常驻 Flow，负责维护 Self（Stone）的长期数据。
   * 普通 Flow 通过 talkToSelf 向 ReflectFlow 发消息，ReflectFlow 是唯一可写 Self 目录的 Flow。
   */
  private _ensureReflectFlow(stone: Stone, session: Session): Flow {
    const selfMetaFlow = Flow.ensureReflectFlow(stone.reflectDir, stone.name);

    /* 注册到 session（如果尚未注册） */
    const selfMetaKey = `_reflect:${stone.name}`;
    if (!session.hasFlow(selfMetaKey)) {
      session.register(selfMetaKey, selfMetaFlow);
    }

    return selfMetaFlow;
  }

  /* ========== 访问器 ========== */

  get registry(): Registry {
    return this._registry;
  }

  get rootDir(): string {
    return this._rootDir;
  }

  /** 顶层 flows/ 目录路径 */
  get flowsDir(): string {
    return join(this._rootDir, "flows");
  }

  /** 获取定时任务管理器 */
  get cron(): CronManager {
    return this._cron;
  }
}
