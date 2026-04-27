/**
 * Open-Files 中枢（Phase 3）
 *
 * 把原先 "trait 激活" 抽象折叠为 "文件 open 集合"。
 *
 * 核心断言（参见 spec）：
 *   Context 是一组"当前 open 的文件"。LLM 看见哪些文件的内容，
 *   就拥有那些能力和知识。
 *
 * 本模块提供统一的 `getOpenFiles(input)`，输出三类：
 *
 * - `pinned`    Origin 阶段（常驻）open 的文件：stone readme.activated_traits +
 *               data._traits_ref 解析出的 trait，加上线程显式 pin 的 trait。
 *
 * - `transient` Process 阶段由 command_binding / open(type="command") /
 *               refine 触发的 trait 激活。**form 关闭后自动回收**。
 *
 * - `inject`    Target 阶段需要渲染到 context 的片段（如 <relations> 索引）。
 *               Phase 3 默认空数组；Phase 5/6 填充。
 *
 * 另外为方便过渡期调用方，本模块提供：
 * - `instructions`：pinned + transient 中的 kernel trait 合并 readme（系统指令位）
 * - `knowledge`：pinned + transient 中的非 kernel trait 合并 readme（知识位）
 * - `activeTraitIds`：所有 open 中 trait 的完整 ID 去重列表（供 debug / 方法筛选）
 *
 * 行为等价：`getOpenFiles` 内部调用 getActiveTraits + pinnedTraits 划分，
 * 保证与原调用链产生相同的 trait 集合（deps 递归、显式激活）。
 *
 * @ref docs/superpowers/specs/2026-04-23-three-phase-trait-activation-design.md#第四部分-统一激活中枢
 */

import type { TraitDefinition, StoneData, ContextWindow, ContextWindowSource } from "../../shared/types/index.js";
import type {
  ThreadsTreeFile,
  ThreadDataFile,
} from "../../thinkable/thread-tree/types.js";
import { getActiveTraits, traitId as activatorTraitId } from "../knowledge/activator.js";
import { getAncestorPath } from "../../storable/thread/persistence.js";
import {
  computeThreadScopeChain,
  extractStoneTraitRefs,
} from "../../thinkable/context/builder.js";

/**
 * open-files 的输入参数
 *
 * 与 buildThreadContext 的输入子集一致；凡是影响"当前 open 哪些文件"的
 * 状态都以只读方式传入（不修改 tree / threadData）。
 */
export interface OpenFilesInput {
  tree: ThreadsTreeFile;
  threadId: string;
  threadData: ThreadDataFile;
  stone: StoneData;
  traits: TraitDefinition[];
}

/**
 * open-files 的输出
 *
 * 与 spec "第四部分 统一激活中枢" 对齐；instructions/knowledge 是过渡期
 * 便利拆分——调用方可直接拿去填 <system> / <user> 的知识区域。
 */
export interface OpenFiles {
  /** Origin 阶段 open 的文件（stone 默认 + 线程 pin 的） */
  pinned: ContextWindow[];
  /** Process 阶段 open 的文件（command_binding / refine 触发的，form 关闭即回收） */
  transient: ContextWindow[];
  /** Target 阶段要 inject 到 context 的渲染片段（<relations> 等；Phase 5/6 填充） */
  inject: ContextWindow[];

  /** 便利：kernel 类 trait 的 readme（填 <system>/<instructions>） */
  instructions: ContextWindow[];
  /** 便利：非 kernel trait 的 readme + 额外窗口（填 <system>/<knowledge>） */
  knowledge: ContextWindow[];
  /** 便利：所有 open 中 trait 的完整 traitId（去重；供 debug / 方法筛选） */
  activeTraitIds: string[];
}

/** kernel 前缀判断（与 context-builder.isKernelTrait 一致，此处独立副本避免循环依赖） */
function isKernelTrait(id: string): boolean {
  return id.startsWith("kernel:");
}

/**
 * 获取当前线程下所有 open 的文件集合
 *
 * 等价于原 `context-builder.buildThreadContext` 内的 scopeChain + getActiveTraits
 * 逻辑，只是出口换成 OpenFiles 结构。
 *
 * 执行步骤：
 * 1. scope chain：stone._traits_ref + 祖先链 traits + activatedTraits（computeThreadScopeChain）
 * 2. 激活集合：getActiveTraits（处理 scope chain / deps 递归）
 * 3. 按 pinnedTraits 拆分：在 pinnedTraits 里的 → pinned；否则 → transient
 * 4. 按 namespace 拆分 instructions（kernel）/ knowledge（非 kernel）
 */
export function getOpenFiles(input: OpenFilesInput): OpenFiles {
  const { tree, threadId, threadData, stone, traits } = input;
  const nodeMeta = tree.nodes[threadId];
  if (!nodeMeta) {
    /* 节点不存在：返回全空（调用方自行处理；不抛以免破坏调度链） */
    return emptyResult();
  }

  /* 1. scope chain */
  const stoneRefs = extractStoneTraitRefs(stone, traits);
  const scopeChain = computeThreadScopeChain(tree, threadId, stoneRefs);

  /* 2. 激活集合（含 deps 递归） */
  const activeTraits = getActiveTraits(traits, scopeChain);

  /* 3. pinned 集合（同旧逻辑） */
  const pinnedKeys = new Set<string>([
    ...stoneRefs,
    ...(nodeMeta.pinnedTraits ?? []),
  ]);
  if (activeTraits.some((t) => activatorTraitId(t) === "kernel:base")) pinnedKeys.add("kernel:base");

  /* Phase 3 — llm_input_viewer：计算每个 window 的 source（来源溯源）。
   *
   * 收集以下集合以做优先级判定：
   * - stoneRefSet: stone._traits_ref（对象级默认）
   * - threadPinnedSet: 当前节点 pinnedTraits（线程显式 pin）
   * - activatedSet: 祖先链任一节点的 activatedTraits（由 open/command_binding 动态激活）
   * - scopeTraitsSet: 祖先链任一节点的 traits 字段（静态声明集合）
   */
  const stoneRefSet = new Set(stoneRefs);
  const threadPinnedSet = new Set(nodeMeta.pinnedTraits ?? []);
  const activatedSet = new Set<string>();
  const scopeTraitsSet = new Set<string>();
  const ancestorIds = getAncestorPath(tree, threadId);
  for (const id of ancestorIds) {
    const n = tree.nodes[id];
    if (!n) continue;
    if (n.traits) {
      for (const t of n.traits) scopeTraitsSet.add(t);
    }
    if (n.activatedTraits) {
      for (const t of n.activatedTraits) activatedSet.add(t);
    }
  }

  function determineSource(t: TraitDefinition, id: string): ContextWindowSource {
    /* 优先级：精确 → 泛化
     * 1. always_on：kernel:base 协议基座常驻
     * 2. thread_pinned：当前节点显式 pin
     * 3. stone_default：stone._traits_ref 声明
     * 4. command_binding：任何节点 activatedTraits 动态激活
     * 5. scope_chain：兜底——祖先 traits 声明集合 */
    if (id === "kernel:base") return "always_on";
    if (threadPinnedSet.has(id)) return "thread_pinned";
    if (stoneRefSet.has(id)) return "stone_default";
    if (activatedSet.has(id)) return "command_binding";
    if (scopeTraitsSet.has(id)) return "scope_chain";
    return "scope_chain";
  }

  const pinned: ContextWindow[] = [];
  const transient: ContextWindow[] = [];
  const instructions: ContextWindow[] = [];
  const knowledge: ContextWindow[] = [];
  const activeTraitIds: string[] = [];
  const seenIds = new Set<string>();

  for (const t of activeTraits) {
    const id = activatorTraitId(t);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    activeTraitIds.push(id);

    if (!t.readme) continue; /* 无 readme（如部分 view）不参与 window 生成 */

    const isPinned = pinnedKeys.has(id);
    const source = determineSource(t, id);
    const window: ContextWindow = {
      name: id,
      content: t.readme,
      lifespan: isPinned ? "pinned" : "transient",
      source,
    };

    if (isPinned) pinned.push(window);
    else transient.push(window);

    if (isKernelTrait(id)) instructions.push(window);
    else knowledge.push(window);
  }

  void threadData; /* 当前阶段不直接读 threadData；Phase 5/6 扩展 */

  return {
    pinned,
    transient,
    inject: [],
    instructions,
    knowledge,
    activeTraitIds,
  };
}

function emptyResult(): OpenFiles {
  return {
    pinned: [],
    transient: [],
    inject: [],
    instructions: [],
    knowledge: [],
    activeTraitIds: [],
  };
}
