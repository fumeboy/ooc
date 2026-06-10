/**
 * Trigger 表达式解析与求值。
 *
 * 2026-05-28 起 knowledge frontmatter 的 `activates_on` 由"path list 双桶"切换
 * 为 trigger map。本模块提供：
 *
 * 1. 四类 trigger 语法的解析与校验（`parseTrigger`）：
 *    - `object::<type>` —— 任意 open 的该类 object 出现时命中
 *      （旧格式 `window::<type>` 自动映射，向后兼容）
 *    - `method::<object_type>::<method>` —— thread 中存在 type=method_exec 的
 *      form，且其 parentObject 的 type === <object_type> 且 form.method === <method>
 *    - `intent::<name>` —— 任一活跃 form 的 intent 集合匹配 <name> 时命中（支持 wildcard 后缀 "program.*"）
 *    - `object_id::<id>` —— 特定 objectId 的 object 出现在 context 中时命中
 *    - `super` —— `thread.persistence?.sessionId === SUPER_SESSION_ID`
 *
 * 2. 单次求值（`evaluateTrigger`）：纯函数，输入 trigger + thread，输出 boolean。
 *
 * 3. 多 trigger max 合并（消费方在 activator.computeActivations 实现）。
 *
 * 设计原则：
 * - **fail-loud**：未知 trigger 形态在 parse 时就 throw（loader 上层 `catch` 决定是否
 *   吞错；activator 自身在解析失败时 console.warn 并跳过该篇）
 * - **纯函数**：parseTrigger / evaluateTrigger 不读文件、不带状态
 * - **向后兼容**：旧格式 `window::` 在 parse 时自动归一化为新的
 *   `object::` / `method::` AST，evaluateTrigger 只需要处理新的 kind 名
 */

import type { ThreadContext } from "../context";
import type { MethodExecWindow, ContextWindow } from "../../executable/windows/_shared/types";
import { SUPER_SESSION_ID } from "@ooc/core/_shared/types/constants.js";

/** trigger 抽象语法树——parse 一次，evaluate 多次。
 *  2026-05-28 ooc-6: 旧的 `window` kind 在 parse 时自动归一化为
 *  `object` / `method`，AST 中只保留新 kind 名。
 */
export type Trigger =
  | { kind: "object"; objectType: string }
  | { kind: "method"; objectType: string; method: string }
  | { kind: "objectId"; objectId: string }
  | { kind: "super" }
  | { kind: "intent"; intentName: string };

/**
 * 解析 trigger 表达式字符串。
 *
 * 合法形态（新格式优先,旧格式向后兼容自动映射）:
 * - `"object::<type>"` — type 非空,不含 `::`
 * - `"method::<object_type>::<method>"` — 两段都非空,object_type 不含 `::`
 * - `"object_id::<id>"` — 特定 objectId,非空,不含 `::`
 * - `"super"`
 *
 * 旧格式(自动映射):
 * - `"window::<type>"` → 映射为 `{ kind: "object", objectType: <type> }`
 *
 * 任何其它形态（含旧 path 如 `"root"` / `"talk"` / `"program.shell"` / `"command::"`）→ throw。
 */
export function parseTrigger(expr: string): Trigger {
  if (typeof expr !== "string" || expr.length === 0) {
    throw new Error(`Invalid trigger expression: ${JSON.stringify(expr)} (empty)`);
  }
  if (expr === "super") return { kind: "super" };

  // ── 新格式 ──────────────────────────────────────────────────────────
  if (expr.startsWith("object::")) {
    const objectType = expr.slice("object::".length);
    if (objectType.length === 0 || objectType.includes("::")) {
      throw new Error(`Invalid trigger: "${expr}" — expected object::<type>`);
    }
    return { kind: "object", objectType };
  }

  if (expr.startsWith("method::")) {
    const rest = expr.slice("method::".length);
    const idx = rest.indexOf("::");
    if (idx <= 0 || idx === rest.length - 2) {
      throw new Error(
        `Invalid trigger: "${expr}" — expected method::<object_type>::<method>`,
      );
    }
    const objectType = rest.slice(0, idx);
    const method = rest.slice(idx + 2);
    if (
      objectType.length === 0 ||
      method.length === 0 ||
      method.includes("::")
    ) {
      throw new Error(
        `Invalid trigger: "${expr}" — expected method::<object_type>::<method>`,
      );
    }
    return { kind: "method", objectType, method };
  }

  // P5e: New intent::<name> format — matches when any active form has an intent matching <name>.
  if (expr.startsWith("intent::")) {
    const intentName = expr.slice("intent::".length);
    if (intentName.length === 0 || intentName.includes("::")) {
      throw new Error(`Invalid trigger: "${expr}" — expected intent::<name>`);
    }
    return { kind: "intent", intentName };
  }

  if (expr.startsWith("object_id::")) {
    const objectId = expr.slice("object_id::".length);
    if (objectId.length === 0 || objectId.includes("::")) {
      throw new Error(`Invalid trigger: "${expr}" — expected object_id::<id>`);
    }
    return { kind: "objectId", objectId };
  }

  // ── 旧格式（向后兼容,自动映射为新 kind） ────────────────────────────
  if (expr.startsWith("window::")) {
    const windowType = expr.slice("window::".length);
    if (windowType.length === 0 || windowType.includes("::")) {
      throw new Error(`Invalid trigger: "${expr}" — expected window::<type>`);
    }
    return { kind: "object", objectType: windowType };
  }

  throw new Error(
    `Unknown trigger expression: "${expr}". Supported: ` +
      `"object::<type>" | "method::<object_type>::<method>" | "intent::<name>" | "object_id::<id>" | "super" ` +
      `(legacy: "window::<type>")`,
  );
}

/**
 * 校验整张 activates_on map：keys 必须全部合法，values 必须 ∈ {show_description, show_content}。
 *
 * 用于 loader 层在装载 .md 时早 fail——
 * 不该让一个写错 trigger 的 knowledge 文件静默失效（silent-swallow ban）。
 *
 * 返回：所有解析后的 trigger entries（[trigger AST, level] 对）。
 */
export function parseActivatesOn(
  activates_on: unknown,
  filePath: string,
): Array<{ trigger: Trigger; level: "show_description" | "show_content"; expr: string }> {
  if (activates_on === undefined || activates_on === null) return [];
  if (typeof activates_on !== "object" || Array.isArray(activates_on)) {
    throw new Error(
      `[${filePath}] activates_on must be an object map; got ${typeof activates_on}`,
    );
  }
  const out: Array<{
    trigger: Trigger;
    level: "show_description" | "show_content";
    expr: string;
  }> = [];
  for (const [expr, level] of Object.entries(activates_on as Record<string, unknown>)) {
    // 检测旧 schema 漏改：show_description_when / show_content_when 是旧字段名
    if (expr === "show_description_when" || expr === "show_content_when") {
      throw new Error(
        `[${filePath}] activates_on uses legacy schema "${expr}: [...]". ` +
          `Migrate to the new trigger map: { "object::root": "show_description", "method::root::talk": "show_content", ... }`,
      );
    }
    if (level !== "show_description" && level !== "show_content") {
      throw new Error(
        `[${filePath}] activates_on["${expr}"] must be "show_description" or "show_content"; got ${JSON.stringify(level)}`,
      );
    }
    const trigger = parseTrigger(expr);
    out.push({ trigger, level, expr });
  }
  return out;
}

/**
 * 单 trigger 求值。
 *
 * 不读取 thread 之外任何状态——纯函数；可用于测试与 activator 内部循环。
 *
 * 2026-05-28 ooc-6: AST 只包含新 kind 名（object/method/objectId/super）,
 * 旧的 window/command 在 parseTrigger 阶段已归一化。
 */
export function evaluateTrigger(trigger: Trigger, thread: ThreadContext): boolean {
  switch (trigger.kind) {
    case "super":
      return thread.persistence?.sessionId === SUPER_SESSION_ID;

    case "object": {
      // root 是每个 thread 的隐式父 window（manager 提供虚拟 root view，从不 push 进 contextWindows）。
      // super flow 沉淀协议把 `object::root` 文档化为「等价任何时候」，agent 据此沉淀的 memory 都用它。
      // 若按下方扫 contextWindows 匹配 type==="root" 则**永不命中** → 沉淀的 memory 永不激活、召回闭环
      // 静默断。特判 root 为 always-on，坐实契约。
      if (trigger.objectType === "root") return true;
      const list = (thread.contextWindows ?? []) as ContextWindow[]; // batch C narrowing(N4): base[] → union[] 以传入 isOpen/byId map（runtime 即 union 实例）。
      for (const w of list) {
        if (w.type !== trigger.objectType) continue;
        if (isOpen(w)) return true;
      }
      return false;
    }

    case "objectId": {
      const list = (thread.contextWindows ?? []) as ContextWindow[]; // batch C narrowing(N4): base[] → union[] 以传入 isOpen/byId map（runtime 即 union 实例）。
      for (const w of list) {
        // ooc-6 Object Unification: window.id = objectId for custom objects
        if (w.id !== trigger.objectId) continue;
        if (isOpen(w)) return true;
      }
      return false;
    }

    case "method": {
      const list = (thread.contextWindows ?? []) as ContextWindow[]; // batch C narrowing(N4): base[] → union[] 以传入 isOpen/byId map（runtime 即 union 实例）。
      // 先做一次按 id 的 parent 索引，避免 O(n²)；通常 windows 量级小，O(n) 也无妨。
      const byId = new Map<string, ContextWindow>();
      for (const w of list) byId.set(w.id, w);

      for (const w of list) {
        if (w.type !== "method_exec") continue;
        const form = w as MethodExecWindow;
        if (form.method !== trigger.method) continue;
        // form 必须 open 才视为"该 method 当前活跃"——success/failed 不算
        if (!isOpen(form)) continue;
        const parentType = parentTypeOf(form, byId);
        if (parentType === trigger.objectType) return true;
      }
      return false;
    }

    case "intent": {
      // P5e: Check intentCache for any form whose intents match the pattern.
      const cache = thread.intentCache;
      if (!cache) return false;
      for (const entry of cache.values()) {
        if (!entry.intents) continue;
        for (const intent of entry.intents) {
          if (matchesIntentName(intent.name, trigger.intentName)) return true;
        }
      }
      return false;
    }
  }
}

/**
 * ContextWindow 是否算作"在 context 中活跃"——用于 trigger 命中判断。
 * 包含:
 * - `status === "open"` (大多数 window type 的常规状态)
 * - `status === "active"` (root / skill_index / custom 等常驻型 object)
 * - status 缺省 (向后兼容)
 */
function isOpen(w: ContextWindow): boolean {
  return w.status === "open" || w.status === "active" || w.status === undefined;
}

/** form 的 parent window type；parentWindowId === "root" 或 missing 时视为 "root"。 */
function parentTypeOf(
  form: MethodExecWindow,
  byId: Map<string, ContextWindow>,
): string {
  const pid = form.parentWindowId;
  if (!pid || pid === "root") return "root";
  const parent = byId.get(pid);
  return parent?.type ?? "root";
}

/**
 * P5e: Check if an intent name matches a pattern. Supports:
 * - exact match: "program" matches "program"
 * - wildcard suffix: "program.*" matches "program" and "program.shell"
 */
export function matchesIntentName(name: string, pattern: string): boolean {
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return name === prefix || name.startsWith(prefix + ".");
  }
  return name === pattern;
}

/**
 * 把多个 trigger 命中合并为最终级别：
 * - 任一命中 show_content → "show_content"
 * - 否则任一命中 show_description → "show_description"
 * - 都不命中 → undefined（未激活）
 */
export function maxLevel(
  hits: Array<"show_description" | "show_content">,
): "show_description" | "show_content" | undefined {
  if (hits.length === 0) return undefined;
  if (hits.some((l) => l === "show_content")) return "show_content";
  return "show_description";
}
