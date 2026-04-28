/**
 * World —— OOC 系统的根对象 (G7, G8)
 *
 * World 是 OOC 的根对象，它管理所有其他对象。
 * World 不是「生态中的一个对象」，而是「生态本身」。
 * 但它仍然遵循 G1——它有 readme.md、data.json，它是一个 OOC Object。
 *
 * 线程树架构（kernel/src/thinkable/engine + kernel/src/thinkable/thread-tree）是唯一执行路径，旧 Flow 架构已于 2026-04-21 退役。
 *
 * @ref docs/哲学文档/gene.md#G1 — implements — World 本身也是对象
 * @ref docs/哲学文档/gene.md#G7 — implements — .ooc/ 目录即 World 的物理存在
 * @ref docs/哲学文档/gene.md#G8 — implements — 消息投递（talk/talkInSpace）、对象创建
 * @ref src/world/registry.ts — references — Registry 对象注册表
 * @ref src/thinkable/engine/engine.ts — references — 线程树执行引擎
 */

import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { consola } from "consola";
import { Registry } from "./registry.js";
import { CronManager } from "./cron.js";
import { registerDefaultHooks } from "./hooks.js";
import { startTestFailureBridge } from "./test-failure-bridge.js";
import { Stone } from "../object/index.js";
import { loadAllTraits, loadTraitsByRef } from "../extendable/trait/index.js";
import { OpenAICompatibleClient, type LLMClient } from "../thinkable/llm/client.js";
import { DefaultConfig, type LLMConfig } from "../thinkable/llm/config.js";
import { emitSSE } from "../observable/server/events.js";
import { runWithThreadTree, resumeWithThreadTree, stepOnceWithThreadTree, writeThreadTreeFlowData, type EngineConfig, type TalkResult, type TalkReturn } from "../thinkable/engine/engine.js";
import { runSuperThread } from "../collaborable/super/super-thread.js";
import { loadSkills } from "../extendable/skill/index.js";
import { appendUserInbox } from "../storable/inbox/user-inbox.js";
import { handleOnTalkToSuper } from "../collaborable/super/super.js";
import { SuperScheduler } from "../collaborable/super/super-scheduler.js";
import { MemoryCurator } from "../storable/memory/curator.js";

/** World 配置 */
export interface WorldConfig {
  /** user repo 根目录路径 */
  rootDir: string;
  /** LLM 配置（可选，默认使用 DefaultConfig） */
  llmConfig?: LLMConfig;
}

/**
 * 处理 talk(target="user") 的 onTalk 分支
 *
 * user 不参与 ThinkLoop：
 * 1. 通过 SSE 广播 flow:message 事件，前端实时渲染
 * 2. 向 flows/{sessionId}/user/data.json 的 inbox 追加一条 (threadId, messageId)
 *    引用索引——前端凭此反查 thread.json.events 里的消息正文
 * 3. 返回 { reply: null, remoteThreadId: "user" } — user 没有 thread 也不会回复
 *
 * 抽成独立 helper 消除 `_talkWithThreadTree` 与 `_buildEngineConfig` 中的代码重复。
 *
 * inbox 写失败不回滚 SSE、不抛——inbox 只是索引，丢一条不应阻塞对话主流程。
 *
 * @param fromObject - 发起方对象名
 * @param message - 消息内容
 * @param sessionId - 当前 session ID
 * @param fromThreadId - 发起方线程 ID（用于写 inbox；缺失时 inbox 跳过写入）
 * @param messageId - engine 生成的 message_out event id（缺失时 inbox 跳过写入）
 * @param flowsDir - flows/ 根目录（用于定位 user/data.json 路径）
 */
function handleOnTalkToUser(params: {
  fromObject: string;
  message: string;
  sessionId: string;
  fromThreadId: string;
  messageId?: string;
  flowsDir: string;
}): { reply: null; remoteThreadId: string } {
  const { fromObject, message, sessionId, fromThreadId, messageId, flowsDir } = params;
  emitSSE({
    type: "flow:message",
    objectName: fromObject,
    sessionId,
    message: {
      /* id 来自 engine 的 genMessageOutId()——前端按 id 匹配 thread event 里的 message_out，
       * 避免旧 "content prefix + timestamp" 启发式匹配的不稳定 */
      ...(messageId ? { id: messageId } : {}),
      direction: "out",
      from: fromObject,
      to: "user",
      content: message,
      timestamp: Date.now(),
    },
  });
  consola.info(`[World] ${fromObject} → user: 已投递（不触发 user thinkloop）`);

  /* 追加 user inbox 索引——只有在 threadId + messageId 都齐备时写入 */
  if (fromThreadId && messageId) {
    /* 不等待：写失败只记 console.error，不影响调用方 */
    void appendUserInbox(flowsDir, sessionId, fromThreadId, messageId).catch((err) => {
      console.error(
        `[World] user inbox 写入失败 (session=${sessionId}, threadId=${fromThreadId}, messageId=${messageId}):`,
        err,
      );
    });
  }

  return { reply: null, remoteThreadId: "user" };
}

/** World 实例 */
export class World {
  /** user repo 根目录 */
  private readonly _rootDir: string;
  /** 对象注册表 */
  private readonly _registry: Registry;
  /** LLM 客户端 */
  private readonly _llm: LLMClient;
  /** 暂停请求集合（运行时状态，不持久化） */
  private readonly _pauseRequests = new Set<string>();
  /** 定时任务管理器 */
  private _cron: CronManager;
  /** trait 树形索引（loadAllTraits 后填充） */
  private _traitTree: import("../shared/types/index.js").TraitTree[] = [];
  /** debug 模式开关 */
  private _debugEnabled = false;
  /** 全局暂停开关 */
  private _globalPaused = false;
  /**
   * Test Failure Bridge 的卸载函数
   *
   * 由 init() 在 OOC_TEST_FAILURE_BRIDGE=1 时启动 runner → world 失败桥；
   * stopSuperScheduler() 在优雅停机时也调用它解除订阅，避免泄漏。
   */
  private _stopTestFailureBridge: () => void = () => {};
  /**
   * SuperScheduler —— 跨 session 常驻调度器（G12 经验沉淀循环的工程通道）
   *
   * polling 扫所有对象的 `stones/{name}/super/`，发现 unread inbox 就触发
   * super 线程跑一轮 ThinkLoop。runner 内部构建 EngineConfig 并调
   * runSuperThread——目录指向 super 而非 flows/{sid}/，跨 session 常驻。
   *
   * 启动：init() 中注册所有对象 + start()
   * 停止：stopSuperScheduler()（graceful shutdown）
   */
  private _superScheduler: SuperScheduler;
  /**
   * MemoryCurator —— 结构化 memory 周期维护（Phase 2）
   *
   * 默认每 30 秒 tick 一次，触发条件：
   * - 距上次 curation 超过 5 分钟 OR
   * - 累积 20 条新 entry
   * 触发时跑 mergeDuplicateEntries + rebuildMemoryIndex。
   *
   * 与 SuperScheduler 并列，但关注"数据层维护"而非"inbox 消费"。
   */
  private _memoryCurator: MemoryCurator;

  constructor(config: WorldConfig) {
    this._rootDir = config.rootDir;
    this._registry = new Registry(join(config.rootDir, "stones"));
    this._llm = new OpenAICompatibleClient(config.llmConfig ?? DefaultConfig());
    this._cron = new CronManager((task) => {
      this.talk(task.targetObject, task.message, `cron:${task.createdBy}`).catch(err => {
        consola.error(`[Cron] 定时任务 ${task.id} 执行失败:`, err);
      });
    });
    /* SuperScheduler 在 constructor 阶段创建（runner 是箭头函数闭包，访问 this._registry / this._llm 等）。
     * 注册和 start 在 init() 中执行——确保 stones 已 loadAll。 */
    this._superScheduler = new SuperScheduler({
      runner: async ({ stoneName, superDir }) => {
        const stone = this._registry.get(stoneName);
        if (!stone) {
          consola.warn(`[World] super runner: 对象 "${stoneName}" 不存在，跳过`);
          return;
        }
        /* 每次执行重新构建 config——traits / directory 可能动态变化（如 trait 热加载） */
        const engineConfig = await this._buildEngineConfig(stone);
        await runSuperThread(stoneName, superDir, engineConfig);
      },
    });
    this._memoryCurator = new MemoryCurator();
  }

  /* ========== Debug 模式（写 debug 文件，不暂停） ========== */

  /**
   * 开启 debug 模式
   *
   * Debug 模式下，每轮 LLM 执行后 OOC 会写入 loop_N.input.txt / loop_N.output.txt / loop_N.thinking.txt / loop_N.meta.json
   * 到 threads/{threadId}/debug/ 目录，用于事后排查。**不暂停执行**。
   */
  enableDebug(): void { this._debugEnabled = true; }

  /** 关闭 debug 模式，停止写 debug 文件 */
  disableDebug(): void { this._debugEnabled = false; }

  /** 查询 debug 模式状态（是否写 debug 文件） */
  isDebugEnabled(): boolean { return this._debugEnabled; }

  /* ========== 全局暂停（暂停执行，不写 debug 文件） ========== */

  /**
   * 开启全局暂停
   *
   * 全局暂停下，所有 running 线程在当前 LLM 轮次结束后进入 paused 状态，
   * 需要 `POST /api/objects/:name/resume` 手动唤醒。
   * 与 debug 模式无关——debug 模式仅写文件，全局暂停才暂停执行。
   */
  enableGlobalPause(): void { this._globalPaused = true; }

  /** 关闭全局暂停，但不自动唤醒已暂停的线程 */
  disableGlobalPause(): void { this._globalPaused = false; }

  /** 查询全局暂停状态 */
  isGlobalPaused(): boolean { return this._globalPaused; }

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

    /* 注册默认 build hooks（json-syntax；OOC_BUILD_HOOKS_TSC=1 时也注册 tsc-check） */
    try {
      registerDefaultHooks();
    } catch (e) {
      consola.warn("[World] 注册 build hooks 失败（继续启动）:", (e as Error).message);
    }

    /* 注册所有对象到 SuperScheduler 并启动 polling
     * 每个对象都有自己的 super 镜像分身（即使从未被 talk(super)，目录也可能不存在——
     * SuperScheduler 内部 _needsRun 已 robust 处理"目录不存在"场景，注册都是安全的）。
     * user 对象排除：user 不参与 ThinkLoop，无 super 概念。 */
    for (const obj of this._registry.all()) {
      if (obj.name === "user") continue;
      this._superScheduler.register(obj.name, this._rootDir);
      /* MemoryCurator 按 selfDir 注册（{rootDir}/stones/{name}） */
      this._memoryCurator.register(obj.name, obj.dir);
    }
    this._superScheduler.start();
    this._memoryCurator.start();

    /* 启动 runner → world 失败桥：把 test runner 的失败事件投递给 supervisor（或指定对象）
     * 默认关闭，需 OOC_TEST_FAILURE_BRIDGE=1 开启。 */
    try {
      this._stopTestFailureBridge = startTestFailureBridge({
        lookup: {
          names: () => this._registry.names(),
          has: (n) => this._registry.get(n) !== undefined,
        },
        talk: (recipient, message) => this.talk(recipient, message, "test_runner"),
      });
    } catch (e) {
      consola.warn("[World] 启动 test failure bridge 失败（继续启动）:", (e as Error).message);
    }
  }

  /**
   * 优雅停机 SuperScheduler（等所有 in-flight runner 完成后返回）
   *
   * 通常在进程退出（SIGINT / SIGTERM）时调用。本方法幂等。
   */
  async stopSuperScheduler(): Promise<void> {
    /* 顺带解除 test failure bridge 订阅 */
    try {
      this._stopTestFailureBridge();
    } catch {
      /* 卸载失败不影响 supervisor 停止 */
    }
    await this._superScheduler.stop();
    await this._memoryCurator.stop();
  }

  /** 获取 SuperScheduler 实例（用于测试 / 手动 tick / 健康检查） */
  get superScheduler(): SuperScheduler {
    return this._superScheduler;
  }

  /** 获取 MemoryCurator 实例（用于测试 / 手动 tick / UI 健康度查询） */
  get memoryCurator(): MemoryCurator {
    return this._memoryCurator;
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
          "namespace: kernel",
          "name: computable",
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
          "namespace: kernel",
          "name: talkable",
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
          'await talk("user", "你的回复内容");',
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
   * 向对象发送消息，通过线程树引擎执行 ThinkLoop
   *
   * @param objectName - 目标对象名称
   * @param message - 消息内容
   * @param from - 发送者（默认 "user"）
   * @param flowId - 可选，预创建的 session ID 或续写已有 session
   * @returns TalkReturn（线程树执行结果的纯数据快照）
   */
  async talk(objectName: string, message: string, from: string = "user", flowId?: string): Promise<TalkReturn> {
    return this._talkWithThreadTree(objectName, message, from, flowId);
  }

  /**
   * 线程树架构的 talk 实现
   *
   * 使用新的 thread/ 模块执行对话，返回 TalkReturn（与 Flow.toJSON 结构兼容的纯数据对象）。
   * 不再依赖 Flow 类——data.json 直接由 writeThreadTreeFlowData 写入。
   */
  private async _talkWithThreadTree(objectName: string, message: string, from: string, preSessionId?: string, continueThreadId?: string, forkUnderThreadId?: string, messageKind?: string): Promise<TalkReturn> {
    const stone = this._registry.get(objectName);
    if (!stone) throw new Error(`对象 "${objectName}" 不存在`);

    /* 加载 traits */
    const traits = await this._loadTraits(stone);
    const directory = this._registry.buildDirectory();

    /* 构建引擎配置 */
    const engineConfig: EngineConfig = {
      rootDir: this._rootDir,
      flowsDir: this.flowsDir,
      llm: this._llm,
      directory,
      traits,
      skills: loadSkills(join(this._rootDir, "library", "skills")),
      debugEnabled: this._debugEnabled,
      stone: stone.toJSON(),
      paths: {
        stoneDir: stone.dir,
        rootDir: this._rootDir,
        flowsDir: this.flowsDir,
      },
      isPaused: (name) => this._globalPaused || this._pauseRequests.has(name),
      onTalk: async (targetObject, message, fromObject, fromThreadId, sessionId, continueThreadId, messageId, forkUnderThreadId, messageKind) => {
        const target = targetObject.toLowerCase();

        /* user 是系统用户（人类），不参与 ThinkLoop：交由专用 handler 处理 */
        if (target === "user") {
          return handleOnTalkToUser({ fromObject, message, sessionId, fromThreadId, messageId, flowsDir: this.flowsDir });
        }

        /* super 是对象的反思镜像分身（SuperFlow）：
         * 落盘到 stones/{fromObject}/super/ 的独立 ThreadsTree。
         * 当前阶段 super 线程不触发 ThinkLoop（reply=null，异步通道） */
        if (target === "super") {
          return handleOnTalkToSuper({ fromObject, message, rootDir: this._rootDir, messageId });
        }

        /* World 作为路由中间层：启动目标 Object 的线程树，等待完成，返回结果 */
        const modeDesc = forkUnderThreadId
          ? `, fork under=${forkUnderThreadId}`
          : continueThreadId ? `, continue=${continueThreadId}` : "";
        consola.info(`[World] 跨 Object talk: ${fromObject} → ${targetObject}, session=${sessionId}${modeDesc}${messageKind ? ` (kind=${messageKind})` : ""}`);
        try {
          const talkRet = await this._talkWithThreadTree(targetObject, message, fromObject, sessionId, continueThreadId, forkUnderThreadId, messageKind);
          const reply = talkRet.summary ?? talkRet.messages.find((m) => m.direction === "out")?.content ?? null;
          return { reply, remoteThreadId: talkRet.threadId ?? "unknown" };
        } catch (e) {
          consola.error(`[World] 跨 Object talk 失败: ${(e as Error).message}`);
          return { reply: `[错误] ${(e as Error).message}`, remoteThreadId: "error" };
        }
      },
    };

    /* 运行线程树引擎 */
    consola.info(`[World] 使用线程树架构处理 talk: ${from} → ${objectName}${forkUnderThreadId ? ` (fork under ${forkUnderThreadId})` : ""}${messageKind ? ` (kind=${messageKind})` : ""}`);
    const messageTimestamp = Date.now();
    const result: TalkResult = await runWithThreadTree(objectName, message, from, engineConfig, preSessionId, continueThreadId, forkUnderThreadId, messageKind);

    /* 线程树执行结果落盘 + 构造 TalkReturn（兼容 Flow.toJSON 形状） */
    const talkRet = writeThreadTreeFlowData(result, objectName, this.flowsDir, message, from, messageTimestamp);

    consola.info(`[World] 线程树执行完成: session=${result.sessionId}, status=${result.status}, iterations=${result.totalIterations}`);
    return talkRet;
  }

  /**
   * 将线程树执行结果包装为 TalkReturn
   *
   * resumeFlow/stepOnce 的线程树分支使用：result.sessionId 可能已存在数据，
   * 由 writeThreadTreeFlowData 覆盖写入。不追加 inbound 消息（resume 不新增入站消息）。
   */
  private _wrapThreadTreeResult(result: TalkResult, objectName: string, sessionId: string): TalkReturn {
    /* resume/step 场景下 result.sessionId 应等于传入的 sessionId；用 sessionId 兜底 */
    const normalizedResult: TalkResult = { ...result, sessionId: result.sessionId ?? sessionId };
    const talkRet = writeThreadTreeFlowData(normalizedResult, objectName, this.flowsDir);
    consola.info(`[World] 线程树执行完成: session=${sessionId}, status=${result.status}, iterations=${result.totalIterations}`);
    return talkRet;
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
   * 恢复暂停的 Flow（线程树 pause/resume）
   *
   * 清除暂停请求，加载 session 目录下的线程树数据，通过线程树引擎恢复执行。
   */
  async resumeFlow(objectName: string, flowId: string): Promise<TalkReturn> {
    this._pauseRequests.delete(objectName);

    const sessionDir = join(this.flowsDir, flowId);
    const objectFlowDir = join(sessionDir, "objects", objectName);
    const { ThreadsTree } = await import("../thinkable/thread-tree/tree.js");
    const tree = ThreadsTree.load(objectFlowDir);
    if (!tree) throw new Error(`Flow "${flowId}" 不存在或缺少线程树数据`);

    const stone = this._registry.get(objectName);
    if (!stone) throw new Error(`对象 "${objectName}" 不存在`);

    const engineConfig = await this._buildEngineConfig(stone);
    const result = await resumeWithThreadTree(objectName, flowId, engineConfig);
    return this._wrapThreadTreeResult(result, objectName, flowId);
  }

  /**
   * 单步执行（per-thread _debugMode）：运行一轮线程树迭代后自动暂停
   *
   * 这是 per-thread 的单步模式（通过设置 threadData._debugMode），独立于全局 debug 模式。
   * 执行一轮 LLM 迭代后自动暂停，用于细粒度调试单个线程。
   * 重新调用 stepOnce 继续执行下一轮（可选修改 LLM 输出后再执行）。
   *
   * @param modifiedOutput - 可选，替换暂存的 LLM 输出（用于调试时修改模型回复）
   */
  async stepOnce(objectName: string, flowId: string, modifiedOutput?: string): Promise<TalkReturn> {
    this._pauseRequests.delete(objectName);

    const sessionDir = join(this.flowsDir, flowId);
    const objectFlowDir = join(sessionDir, "objects", objectName);
    const { ThreadsTree } = await import("../thinkable/thread-tree/tree.js");
    const tree = ThreadsTree.load(objectFlowDir);
    if (!tree) throw new Error(`Flow "${flowId}" 不存在或缺少线程树数据`);

    const stone = this._registry.get(objectName);
    if (!stone) throw new Error(`对象 "${objectName}" 不存在`);

    const engineConfig = await this._buildEngineConfig(stone);
    const result = await stepOnceWithThreadTree(objectName, flowId, engineConfig, modifiedOutput);
    return this._wrapThreadTreeResult(result, objectName, flowId);
  }

  /**
   * 构建线程树引擎配置（resumeFlow/stepOnce 共享）
   */
  private async _buildEngineConfig(stone: Stone): Promise<EngineConfig> {
    const traits = await this._loadTraits(stone);
    return {
      rootDir: this._rootDir,
      flowsDir: this.flowsDir,
      llm: this._llm,
      directory: this._registry.buildDirectory(),
      traits,
      skills: loadSkills(join(this._rootDir, "library", "skills")),
      debugEnabled: this._debugEnabled,
      stone: stone.toJSON(),
      paths: { stoneDir: stone.dir, rootDir: this._rootDir, flowsDir: this.flowsDir },
      isPaused: (name) => this._globalPaused || this._pauseRequests.has(name),
      onTalk: async (targetObject, message, fromObject, fromThreadId, sessionId, continueThreadId, messageId, forkUnderThreadId, messageKind) => {
        const target = targetObject.toLowerCase();
        if (target === "user") {
          return handleOnTalkToUser({ fromObject, message, sessionId, fromThreadId, messageId, flowsDir: this.flowsDir });
        }
        if (target === "super") {
          return handleOnTalkToSuper({ fromObject, message, rootDir: this._rootDir, messageId });
        }
        try {
          const talkRet = await this._talkWithThreadTree(targetObject, message, fromObject, undefined, continueThreadId, forkUnderThreadId, messageKind);
          const reply = talkRet.summary ?? talkRet.messages.find((m) => m.direction === "out")?.content ?? null;
          return { reply, remoteThreadId: talkRet.threadId ?? "unknown" };
        } catch (e) {
          return { reply: `[错误] ${(e as Error).message}`, remoteThreadId: "error" };
        }
      },
    };
  }

  /**
   * 检查对象是否被暂停
   */
  isObjectPaused(name: string): boolean {
    return this._pauseRequests.has(name);
  }

  /**
   * 获取对象目录路径（供线程树 engine 查询）
   */
  getObjectDir(name: string): string | null {
    const stone = this._registry.get(name);
    return stone ? stone.dir : null;
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

    /* 新协议：传入 objectDir（其下 traits/ + views/ 会被分别扫描） */
    const { traits, tree } = await loadAllTraits(stone.dir, kernelTraitsDir, libraryTraitsDir);
    this._traitTree = tree;

    consola.info(`[World] 加载 ${traits.length} 个 traits/views: ${traits.map(t => t.name).join(", ")}`);
    consola.info(`[World] library traits 方法已全量注册，readme 通过 activateTrait() 按需激活`);
    return traits;
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
