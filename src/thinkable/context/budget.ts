/**
 * Context budget — 自然衰减 (P0d)。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.3
 * Meta:   meta/object.doc.ts:thinkable.children.context_budget.patches.natural_decay
 *
 * 由 ThinkLoop 在每轮 buildContext 前调用 `applyNaturalDecay(thread)` 推进衰减
 * 计数器并在阈值达到时切换 window.compressLevel,落 `context_compressed` ProcessEvent。
 *
 * 规则 (默认参数):
 * - idle-fold   N=3:  window.status ∈ {done, archived, closed, idle} 持续 N 轮 → 0→1
 * - age-fold    M=10: window 自上次被 exec/close 等触达起 M 轮无访问 → 0→1
 * - double-fold K=8:  compressLevel=1 再持续 K 轮 → 1→2
 * - cascade:          parent 被 fold 到 ≥1 时,所有 child window 同档对齐
 *
 * 豁免:
 * - window.type ∈ {root, command_exec} 永不被自然衰减
 * - window.status ∈ {active, running, executing, open} 表示 "LLM 当前在用/IO 在跑",
 *   不计入 idle-fold (idleRounds 重置为 0)
 *
 * 配置:
 * - 路径: stones/<self>/config/context-budget.json
 *   { "naturalDecay": { "idleRoundsN": 3, "ageRoundsM": 10, "doubleFoldRoundsK": 8 } }
 * - 找不到 / 解析失败 / thread 无 persistence → 全部默认值
 *
 * 计数器存储:
 * - 字段 _decayMeta 挂在 ContextWindow 上 (BaseContextWindow._decayMeta),下划线
 *   前缀 + stripVolatileForPersist 剥离,不进 thread.json (冷启动后从 0 重计)。
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { ContextWindow } from "../../executable/windows/_shared/types";
import { deriveStoneFromThread, stoneDir } from "../../persistable/common";
import type { ProcessEvent, ThreadContext } from "./index";

// ─────────────────────────── config ──────────────────────────────────────────

export interface NaturalDecayConfig {
  /** idle-fold 阈值: status ∈ idle-set 持续 N 轮 → 0→1。 */
  idleRoundsN: number;
  /** age-fold 阈值: 无访问 M 轮 → 0→1。 */
  ageRoundsM: number;
  /** double-fold 阈值: level=1 再持续 K 轮 → 1→2。 */
  doubleFoldRoundsK: number;
}

export const DEFAULT_DECAY_CONFIG: NaturalDecayConfig = {
  idleRoundsN: 3,
  ageRoundsM: 10,
  doubleFoldRoundsK: 8,
};

/** 把 stone 上的 context-budget.json 读出来; 失败一律 fallback 到默认值。 */
export function loadDecayConfig(thread: ThreadContext): NaturalDecayConfig {
  const parsed = readBudgetConfigFile(thread);
  const nd = parsed?.naturalDecay ?? {};
  return {
    idleRoundsN: typeof nd.idleRoundsN === "number" && nd.idleRoundsN > 0
      ? nd.idleRoundsN
      : DEFAULT_DECAY_CONFIG.idleRoundsN,
    ageRoundsM: typeof nd.ageRoundsM === "number" && nd.ageRoundsM > 0
      ? nd.ageRoundsM
      : DEFAULT_DECAY_CONFIG.ageRoundsM,
    doubleFoldRoundsK: typeof nd.doubleFoldRoundsK === "number" && nd.doubleFoldRoundsK > 0
      ? nd.doubleFoldRoundsK
      : DEFAULT_DECAY_CONFIG.doubleFoldRoundsK,
  };
}

/** Budget 阈值配置 (token 估算 soft/hard 上限)。 */
export interface BudgetThresholds {
  /** soft 阈值: 超过即给 LLM 一条 <context_budget_warning>; 默认 100000 字符 (≈ 25K token 粗估)。 */
  soft: number;
  /** hard 阈值: 超过则系统强制降级 (level 0→1→2, 最后 events fold); 默认 180000。 */
  hard: number;
}

export const DEFAULT_BUDGET_THRESHOLDS: BudgetThresholds = {
  soft: 100000,
  hard: 180000,
};

/** 从 stone 配置 / 默认值加载 budget 阈值。 */
export function loadBudgetThresholds(thread: ThreadContext): BudgetThresholds {
  const parsed = readBudgetConfigFile(thread);
  const b = parsed?.budget ?? {};
  return {
    soft: typeof b.soft === "number" && b.soft > 0 ? b.soft : DEFAULT_BUDGET_THRESHOLDS.soft,
    hard: typeof b.hard === "number" && b.hard > 0 ? b.hard : DEFAULT_BUDGET_THRESHOLDS.hard,
  };
}

interface BudgetConfigFile {
  naturalDecay?: Partial<NaturalDecayConfig>;
  budget?: Partial<BudgetThresholds>;
}

/** 读取 stone 上的 context-budget.json; 失败 / 缺失一律返回 null。
 *  loadDecayConfig 与 loadBudgetThresholds 共用一份配置文件 (合并字段)。 */
function readBudgetConfigFile(thread: ThreadContext): BudgetConfigFile | null {
  if (!thread.persistence) return null;
  let configPath: string;
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    configPath = join(stoneDir(stoneRef), "config", "context-budget.json");
  } catch {
    return null;
  }
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf8");
    return JSON.parse(raw) as BudgetConfigFile;
  } catch {
    return null;
  }
}

// ─────────────────────────── 内部辅助 ─────────────────────────────────────────

/** "idle" 状态集合 (design 的 idle-set; 字面 "idle" 留作前向兼容,即使当前 WindowStatus 未列举)。
 *  - done / archived / closed:                明确进入收纳态的 window
 *  - idle:                                    保留 design 字面值 (未来 WindowStatus 扩展用)
 */
const IDLE_STATUS_SET: ReadonlySet<string> = new Set(["done", "archived", "closed", "idle"]);

/** 豁免类型:永不被自然衰减触发 (无论 status / age)。
 *  - root:         thread 同生命周期, 不能被关闭
 *  - command_exec: design 明确豁免 "当前活动 form" — 类型本身即是 form 容器
 */
const DECAY_EXEMPT_TYPES: ReadonlySet<string> = new Set(["root", "command_exec"]);

/** 类型 / 状态层面的 "正在等待外部 IO" 豁免集 (额外保护 active in-flight 操作)。
 *  - do_window status=running:    child thread 正在跑, 等待 wait/notify;
 *    M 轮没访问也属正常 IO 等待, 不应 age-fold (LLM 拿不到结果也是设计)
 *  目前只有 do_window 有这种语义;其它类型 status=open/closed 都按一般 window 看。
 */
function isWaitingForIO(window: ContextWindow): boolean {
  return window.type === "do" && window.status === "running";
}

export interface WindowLevelChange {
  windowId: string;
  fromLevel: 0 | 1 | 2;
  toLevel: 1 | 2;
  reason:
    | "idle-fold"
    | "age-fold"
    | "double-fold"
    | "cascade-fold"
    | "emergency-guard-1"
    | "emergency-guard-2";
}

/** 提取一个 event 引用到的 window id 集合 (用于 sinceExecRounds 重置判定)。 */
function extractTouchedWindowIds(event: ProcessEvent): string[] {
  if (
    event.category !== "llm_interaction" ||
    (event.kind !== "function_call" && event.kind !== "tool_use")
  ) {
    return [];
  }
  // function_call / tool_use 都带 arguments
  const args = (event as { arguments?: Record<string, unknown> }).arguments;
  if (!args || typeof args !== "object") return [];
  const ids: string[] = [];
  const single = ["window_id", "parent_window_id", "reply_to_window_id"];
  for (const key of single) {
    const v = args[key];
    if (typeof v === "string" && v.length > 0) ids.push(v);
  }
  const arrayKeys = ["target_ids", "targetIds", "window_ids"];
  for (const key of arrayKeys) {
    const v = args[key];
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === "string") ids.push(x);
    }
  }
  return ids;
}

/** 默认计数器初值。 */
function defaultDecayMeta(): NonNullable<ContextWindow["_decayMeta"]> {
  return { idleRounds: 0, sinceExecRounds: 0, level1Rounds: 0, lastSeenEventIdx: 0 };
}

/** 把 windowId → 是否在本轮被触达 这件事算出来。 */
function buildTouchedMap(
  thread: ThreadContext,
  windows: ContextWindow[],
): Map<string, boolean> {
  const touched = new Map<string, boolean>();
  const events = thread.events ?? [];
  // 以最小 lastSeenEventIdx 为扫描起点(每个 window 独立计算),但常见情况下所有 window 同步,
  // 这里采取保守策略:对每个 window 扫描自己的 lastSeenEventIdx 以后的 events。
  for (const w of windows) {
    const lastSeen = w._decayMeta?.lastSeenEventIdx ?? 0;
    let hit = false;
    for (let i = lastSeen; i < events.length; i++) {
      const ids = extractTouchedWindowIds(events[i]);
      if (ids.includes(w.id)) {
        hit = true;
        break;
      }
    }
    touched.set(w.id, hit);
  }
  return touched;
}

/** parent → children 的反向索引,用于 cascade。 */
function buildChildIndex(windows: ContextWindow[]): Map<string, ContextWindow[]> {
  const idx = new Map<string, ContextWindow[]>();
  for (const w of windows) {
    if (!w.parentWindowId) continue;
    const arr = idx.get(w.parentWindowId) ?? [];
    arr.push(w);
    idx.set(w.parentWindowId, arr);
  }
  return idx;
}

// ─────────────────────────── 主入口 ──────────────────────────────────────────

export interface ApplyNaturalDecayResult {
  /** 实际发生 level 升档的 window 变更列表 (顺序: 触发顺序; cascade 跟在 parent 后)。 */
  changes: WindowLevelChange[];
}

/**
 * 推进 thread 上所有 window 的衰减计数器,在阈值达到时切换 compressLevel,
 * 并写一条聚合 `context_compressed` 事件 (每个 reason 一条,与 compress tool 同协议)。
 *
 * **副作用**:
 * - thread.contextWindows 被替换为新数组 (单元 immutable: 命中切档的 window 用 spread 重建)
 * - thread.events 末尾可能 push 1~4 条 context_compressed 事件 (一种 reason 一条聚合记录)
 */
export function applyNaturalDecay(
  thread: ThreadContext,
  cfg: NaturalDecayConfig = DEFAULT_DECAY_CONFIG,
): ApplyNaturalDecayResult {
  const windows = thread.contextWindows ?? [];
  if (windows.length === 0) return { changes: [] };

  const eventsLength = thread.events?.length ?? 0;
  const touched = buildTouchedMap(thread, windows);
  const childIdx = buildChildIndex(windows);

  // 第一遍: 推进每个 window 的计数器 + 决定是否本轮升档 (不含 cascade)。
  // 用 id → 新 window 副本 的 map 累积修改,最后一次写回 contextWindows。
  const nextById = new Map<string, ContextWindow>();
  const changes: WindowLevelChange[] = [];

  function getNext(w: ContextWindow): ContextWindow {
    const existing = nextById.get(w.id);
    if (existing) return existing;
    // 浅拷贝并把 _decayMeta 也拷成新对象 (避免后续对 meta 的 in-place 写影响旧引用)
    const meta = { ...(w._decayMeta ?? defaultDecayMeta()) };
    const copy = { ...w, _decayMeta: meta } as ContextWindow;
    nextById.set(w.id, copy);
    return copy;
  }

  for (const w of windows) {
    if (DECAY_EXEMPT_TYPES.has(w.type)) {
      // 豁免:不改 level, 但还是把 lastSeenEventIdx 同步,避免 events 累积爆栈
      const n = getNext(w);
      n._decayMeta!.lastSeenEventIdx = eventsLength;
      continue;
    }

    const wasTouched = touched.get(w.id) ?? false;
    const status = w.status as string;
    const isIdle = IDLE_STATUS_SET.has(status);
    const ioWaiting = isWaitingForIO(w);
    const currentLevel = (w.compressLevel ?? 0) as 0 | 1 | 2;

    const next = getNext(w);
    const meta = next._decayMeta!;

    // 1) sinceExecRounds: 若被触达 → 重置 0; 否则 +1
    meta.sinceExecRounds = wasTouched ? 0 : meta.sinceExecRounds + 1;

    // 2) idleRounds: 若 idle → +1; 否则 重置 0
    if (isIdle) {
      meta.idleRounds += 1;
    } else {
      meta.idleRounds = 0;
    }

    // 3) level1Rounds: 仅在 currentLevel === 1 时 +1; 否则 0
    if (currentLevel === 1) {
      meta.level1Rounds += 1;
    } else {
      meta.level1Rounds = 0;
    }

    meta.lastSeenEventIdx = eventsLength;

    // 4) 决定升档 (IO 等待豁免 0→1 触发, 但允许已经在 1 的窗口继续 double-fold)
    if (currentLevel === 0 && !ioWaiting) {
      // idle-fold 优先于 age-fold (相同 0→1 但 reason 更具体)
      if (meta.idleRounds >= cfg.idleRoundsN) {
        next.compressLevel = 1;
        changes.push({ windowId: w.id, fromLevel: 0, toLevel: 1, reason: "idle-fold" });
        // fold 后,把 level1Rounds 重置为 0 (刚 fold,后续才开始累计)
        meta.level1Rounds = 0;
      } else if (meta.sinceExecRounds >= cfg.ageRoundsM) {
        next.compressLevel = 1;
        changes.push({ windowId: w.id, fromLevel: 0, toLevel: 1, reason: "age-fold" });
        meta.level1Rounds = 0;
      }
    } else if (currentLevel === 1) {
      if (meta.level1Rounds >= cfg.doubleFoldRoundsK) {
        next.compressLevel = 2;
        changes.push({ windowId: w.id, fromLevel: 1, toLevel: 2, reason: "double-fold" });
      }
    }
    // currentLevel === 2 不再升档
  }

  // 第二遍: cascade — 凡是被本轮 fold (或预先已 level≥1) 的 parent,
  // 把所有 child 拉到不低于 parent 的同档。为了避免菊花链不收敛,
  // 用 BFS 从所有 "level ≥ 1" 的 window 出发,拉 child。
  const queue: string[] = [];
  for (const w of windows) {
    const final = nextById.get(w.id) ?? w;
    if ((final.compressLevel ?? 0) >= 1) queue.push(w.id);
  }
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const parentFinal = nextById.get(parentId) ?? windows.find((x) => x.id === parentId)!;
    const parentLevel = (parentFinal.compressLevel ?? 0) as 0 | 1 | 2;
    if (parentLevel === 0) continue;
    const kids = childIdx.get(parentId) ?? [];
    for (const child of kids) {
      if (DECAY_EXEMPT_TYPES.has(child.type)) continue;
      const childFinal = nextById.get(child.id) ?? child;
      const childLevel = (childFinal.compressLevel ?? 0) as 0 | 1 | 2;
      if (childLevel >= parentLevel) continue;
      const next = getNext(child);
      next.compressLevel = parentLevel;
      changes.push({
        windowId: child.id,
        fromLevel: childLevel,
        toLevel: parentLevel as 1 | 2,
        reason: "cascade-fold",
      });
      queue.push(child.id);
    }
  }

  // 写回 contextWindows: 用 map 中的副本替换原引用 (immutable per-window)
  if (nextById.size > 0) {
    thread.contextWindows = windows.map((w) => nextById.get(w.id) ?? w);
  }

  // 按 reason 聚合, 落 ProcessEvent (一种 reason 一条)
  if (changes.length > 0) {
    const byReason = new Map<WindowLevelChange["reason"], WindowLevelChange[]>();
    for (const c of changes) {
      const arr = byReason.get(c.reason) ?? [];
      arr.push(c);
      byReason.set(c.reason, arr);
    }
    for (const [reason, arr] of byReason) {
      // 同一 reason 下若 fromLevel 不全相同, levelChange 用 "*"
      const fromSet = new Set(arr.map((c) => c.fromLevel));
      const toSet = new Set(arr.map((c) => c.toLevel));
      const fromLabel = fromSet.size === 1 ? String([...fromSet][0]) : "*";
      const toLabel = toSet.size === 1 ? String([...toSet][0]) : "*";
      const event: ProcessEvent = {
        category: "context_change",
        kind: "context_compressed",
        windowIds: arr.map((c) => c.windowId),
        levelChange: `${fromLabel}→${toLabel}`,
        reason,
      };
      thread.events.push(event);
    }
  }

  return { changes };
}

// ─────────────────────────── emergency guard (P0e) ──────────────────────────

/**
 * 粗估当前 thread 全 level 0 渲染需要的 token 数。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.4
 *
 * **不**精确——目的是给 emergency guard 一个"接近 budget"的相对量。规则:
 * - 把 thread 的关键字段 (contextWindows + events + inbox/outbox + threadLocalData)
 *   JSON.stringify 后取字符长度 / 4 (粗略 1 char ≈ 0.25 token, OpenAI tokenizer 经验值)
 *   (2026-05-26 起 thread.plan 字段已废弃，plan 走 plan_window in contextWindows)
 * - 不计 persistence / parent ref 等系统字段
 * - 单调:窗口/事件越多越大;压缩后窗口体积变小,本函数返回值也变小 (因为 compressLevel 影响
 *   渲染层而非数据,但 emergency guard 的级联跑 wave-2/3 时会推进 level,再次估算时由于 events
 *   多了 context_compressed / events_summary 节点,总长会被 wave-3 (events fold) 显著拉低)。
 */
export function estimateThreadTokens(thread: ThreadContext): number {
  const subset = {
    contextWindows: thread.contextWindows ?? [],
    events: thread.events ?? [],
    inbox: thread.inbox ?? [],
    outbox: thread.outbox ?? [],
    threadLocalData: thread.threadLocalData,
  };
  let raw: string;
  try {
    raw = JSON.stringify(subset);
  } catch {
    // 循环引用等极端情况 (理论上 _parentThreadRef 已经在顶层 strip,但保险起见)
    return 0;
  }
  return Math.ceil(raw.length / 4);
}

/** Budget warning,emergency guard 在 tokens > soft 时返回,ThinkLoop 据此注入 system message。 */
export interface BudgetWarning {
  /** 估算的当前 token 占用。 */
  current: number;
  /** soft 阈值 (触发警告的下限)。 */
  soft: number;
  /** hard 阈值 (触发自动降级的下限)。 */
  hard: number;
}

export interface ApplyEmergencyGuardResult {
  /** 仅当 tokens > soft 时返回;ThinkLoop 据此往 LLM 输入插一条临时警告。 */
  warning?: BudgetWarning;
  /** 实际由 emergency 路径升档的 window 变更列表 (含 wave 1 / 2;wave 3 是 events fold,不进此列表)。 */
  changes: WindowLevelChange[];
  /** 是否进入 wave 3 (events 强制 fold)。 */
  eventsFolded: boolean;
}

/** Emergency-guard 不能动的 window 类型 (与自然衰减豁免一致)。 */
const EMERGENCY_EXEMPT_TYPES: ReadonlySet<string> = new Set(["root", "command_exec"]);

/** "活动 do_window" 的判定:do 且 status=running (子线程在跑) — 不应被 emergency 折叠。 */
function isActiveDoWindow(w: ContextWindow): boolean {
  return w.type === "do" && w.status === "running";
}

/** 把 thread 的所有非豁免 window 中 level === filterLevel 的升到 toLevel,
 *  落一条聚合 ProcessEvent (reason=eventReason),返回 changes 列表。
 *  immutable per-window:命中的 window 用 spread 重建。 */
function emergencyPromoteLevel(
  thread: ThreadContext,
  filterLevel: 0 | 1,
  toLevel: 1 | 2,
  eventReason: "emergency-guard-1" | "emergency-guard-2",
): WindowLevelChange[] {
  const windows = thread.contextWindows ?? [];
  const changes: WindowLevelChange[] = [];
  const next = windows.map((w) => {
    if (EMERGENCY_EXEMPT_TYPES.has(w.type)) return w;
    if (isActiveDoWindow(w)) return w;
    const cur = (w.compressLevel ?? 0) as 0 | 1 | 2;
    if (cur !== filterLevel) return w;
    changes.push({
      windowId: w.id,
      fromLevel: cur,
      toLevel,
      reason: eventReason,
    });
    return { ...w, compressLevel: toLevel } as ContextWindow;
  });
  if (changes.length > 0) {
    thread.contextWindows = next;
    const event: ProcessEvent = {
      category: "context_change",
      kind: "context_compressed",
      windowIds: changes.map((c) => c.windowId),
      levelChange: `${filterLevel}→${toLevel}`,
      reason: eventReason,
      scope: "auto",
    };
    thread.events.push(event);
  }
  return changes;
}

/** Emergency wave 3: events 流强制 fold 中段。
 *  - 不调用 LLM (无 summary 文本,仅 placeholder)
 *  - 物理替换:把 events 数组中段替换为一条 events_summary 节点;原 events 在 thread.json
 *    持久化层是否保留留给 persistable 决策 (P0e 不动 persistable)
 */
const EMERGENCY_EVENTS_HEAD = 10;
const EMERGENCY_EVENTS_TAIL = 40;

/** Emergency wave 3: events 流强制 fold 中段。
 *
 *  实现协议 (与 P0f 对齐, schema 由 context/index.ts 定义):
 *  - 在 head=10 与 tail=40 之间的"中段" events 用 _foldedBy 字段标记 (持久化保留,
 *    渲染层 buildInputItems 跳过),与 P0f 用 LLM summary 走同一渲染路径
 *  - 在中段位置 push 一条 events_summary event,scope="auto",
 *    summary 字段为固定占位 "[auto-fold by emergency guard, no LLM summary available]"
 *    (qualityHint 用 "rough" 标识非 LLM 摘要)
 *  - 同时落一条 context_compressed (scope="events") 作为审计 / visibility 协议统一锚点
 */
function emergencyFoldEvents(thread: ThreadContext): boolean {
  const events = thread.events ?? [];
  const total = events.length;
  if (total <= EMERGENCY_EVENTS_HEAD + EMERGENCY_EVENTS_TAIL) {
    // 数量不足以 fold:wave 3 无效
    return false;
  }

  const summaryId = `events_summary_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const middleStart = EMERGENCY_EVENTS_HEAD;
  const middleEndExclusive = total - EMERGENCY_EVENTS_TAIL;
  const foldedCount = middleEndExclusive - middleStart;

  // 不可变地构造新 events 数组:
  // - head 段保持原样
  // - 在 head 之后立刻插入 events_summary
  // - 中段 events 加 _foldedBy 标记 (浅拷贝;渲染层据此跳过,但持久化保留)
  // - tail 段保持原样
  const head = events.slice(0, middleStart);
  const middleFolded = events.slice(middleStart, middleEndExclusive).map((e) => ({
    ...e,
    _foldedBy: summaryId,
  }));
  const tail = events.slice(middleEndExclusive);

  const summaryEvent: ProcessEvent = {
    id: summaryId,
    category: "context_change",
    kind: "events_summary",
    count: foldedCount,
    summary: "[auto-fold by emergency guard, no LLM summary available]",
    qualityHint: "rough",
    scope: "auto",
  };

  // 排序:head + summary + foldedMiddle (仍在 events 数组中,但渲染时被跳过) + tail
  thread.events = [...head, summaryEvent, ...middleFolded, ...tail];

  // 同时落一条 context_compressed (events scope) 审计事件,与 compress tool / 自然衰减
  // 同协议;reason 明确标记 emergency-guard-events 以便排查。
  thread.events.push({
    category: "context_change",
    kind: "context_compressed",
    windowIds: [],
    levelChange: "events→summary",
    reason: "emergency-guard-events",
    scope: "events",
  });
  return true;
}

/**
 * Emergency budget guard。
 *
 * Design: docs/2026-05-25-context-compression-design.md §4.4
 *
 * 在 ThinkLoop 每轮 buildContext 之前 (applyNaturalDecay 之后) 调用一次。
 *
 * 行为:
 * 1. 估算当前 tokens
 * 2. tokens > soft → 返回 warning (ThinkLoop 据此注入 system message)
 * 3. tokens > hard → 启动三波兜底:
 *    - 波 1: 所有 level=0 非豁免 window 升到 1 (落 context_compressed reason=emergency-guard-1)
 *    - 重新估算; 仍 > hard → 波 2: 所有 level=1 非豁免 window 升到 2 (reason=emergency-guard-2)
 *    - 重新估算; 仍 > hard → 波 3: events 流强制 fold 中段 (placeholder summary,
 *      reason=emergency-guard-events,**不**调用 LLM)
 *
 * **不变量**:
 * - 不调 LLM:emergency 是系统兜底,不引入幽灵 LLM 流量 (design §4.4)
 * - silent-swallow ban:每一波都落 ProcessEvent
 * - 警告**只**在本轮生效:warning 不持久化到 thread.events,只在返回值里告知调用方
 */
export function applyEmergencyGuard(
  thread: ThreadContext,
  thresholds: BudgetThresholds = DEFAULT_BUDGET_THRESHOLDS,
): ApplyEmergencyGuardResult {
  const result: ApplyEmergencyGuardResult = { changes: [], eventsFolded: false };

  const current0 = estimateThreadTokens(thread);
  if (current0 <= thresholds.soft) {
    return result;
  }

  result.warning = { current: current0, soft: thresholds.soft, hard: thresholds.hard };

  if (current0 <= thresholds.hard) {
    // 只警告,不动手
    return result;
  }

  // 波 1: level 0 → 1
  const wave1 = emergencyPromoteLevel(thread, 0, 1, "emergency-guard-1");
  result.changes.push(...wave1);

  let current1 = estimateThreadTokens(thread);
  if (current1 <= thresholds.hard) {
    // 更新 warning.current 以反映最新估算 (虽然下一轮还会重新评估,这里保守更新一次)
    result.warning.current = current1;
    return result;
  }

  // 波 2: level 1 → 2
  const wave2 = emergencyPromoteLevel(thread, 1, 2, "emergency-guard-2");
  result.changes.push(...wave2);

  let current2 = estimateThreadTokens(thread);
  if (current2 <= thresholds.hard) {
    result.warning.current = current2;
    return result;
  }

  // 波 3: events 强制 fold
  const folded = emergencyFoldEvents(thread);
  result.eventsFolded = folded;
  const current3 = estimateThreadTokens(thread);
  result.warning.current = current3;
  return result;
}
