/**
 * Trigger 表达式解析与求值。
 *
 * 2026-05-28 起 knowledge frontmatter 的 `activates_on` 由"path list 双桶"切换
 * 为 trigger map。本模块提供：
 *
 * 1. 三类 trigger 语法的解析与校验（`parseTrigger`）：
 *    - `window::<type>` —— 任意 open 的 ContextWindow 满足 `type === <type>` 命中
 *    - `command::<window_type>::<command>` —— thread 中存在 type=command_exec 的
 *      form，且其 parentWindow 的 type === <window_type> 且 form.command === <command>
 *    - `super` —— `thread.persistence?.sessionId === SUPER_SESSION_ID`
 *
 * 2. 单次求值（`evaluateTrigger`）：纯函数，输入 trigger + thread，输出 boolean。
 *
 * 3. 多 trigger max 合并（消费方在 activator.computeActivations 实现）。
 *
 * 设计原则：
 * - **fail-loud**：未知 trigger 形态在 parse 时就 throw（loader/synthesizer 上层
 *   `catch` 决定是否吞错；activator 自身在解析失败时 console.warn 并跳过该篇）
 * - **纯函数**：parseTrigger / evaluateTrigger 不读文件、不带状态
 */

import type { ThreadContext } from "../context";
import type { CommandExecWindow, ContextWindow } from "../../executable/windows/_shared/types";
import { SUPER_SESSION_ID } from "../../executable/windows/_shared/super-constants";

/** trigger 抽象语法树——parse 一次，evaluate 多次。 */
export type Trigger =
  | { kind: "window"; windowType: string }
  | { kind: "command"; windowType: string; command: string }
  | { kind: "super" };

/**
 * 解析 trigger 表达式字符串。
 *
 * 合法形态：
 * - `"window::<type>"`（type 非空，不含 `::`）
 * - `"command::<window_type>::<command>"`（两段都非空，window_type 不含 `::`）
 * - `"super"`
 *
 * 任何其它形态（含旧 path 如 `"root"` / `"talk"` / `"program.shell"`）→ throw。
 */
export function parseTrigger(expr: string): Trigger {
  if (typeof expr !== "string" || expr.length === 0) {
    throw new Error(`Invalid trigger expression: ${JSON.stringify(expr)} (empty)`);
  }
  if (expr === "super") return { kind: "super" };

  if (expr.startsWith("window::")) {
    const windowType = expr.slice("window::".length);
    if (windowType.length === 0 || windowType.includes("::")) {
      throw new Error(`Invalid trigger: "${expr}" — expected window::<type>`);
    }
    return { kind: "window", windowType };
  }

  if (expr.startsWith("command::")) {
    const rest = expr.slice("command::".length);
    const idx = rest.indexOf("::");
    if (idx <= 0 || idx === rest.length - 2) {
      throw new Error(
        `Invalid trigger: "${expr}" — expected command::<window_type>::<command>`,
      );
    }
    const windowType = rest.slice(0, idx);
    const command = rest.slice(idx + 2);
    if (windowType.length === 0 || command.length === 0 || command.includes("::")) {
      throw new Error(
        `Invalid trigger: "${expr}" — expected command::<window_type>::<command>`,
      );
    }
    return { kind: "command", windowType, command };
  }

  throw new Error(
    `Unknown trigger expression: "${expr}". Supported: ` +
      `"window::<type>" | "command::<window_type>::<command>" | "super"`,
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
          `Migrate to the new trigger map: { "window::root": "show_description", "command::root::talk": "show_content", ... }`,
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
 */
export function evaluateTrigger(trigger: Trigger, thread: ThreadContext): boolean {
  switch (trigger.kind) {
    case "super":
      return thread.persistence?.sessionId === SUPER_SESSION_ID;

    case "window": {
      const list = thread.contextWindows ?? [];
      for (const w of list) {
        if (w.type !== trigger.windowType) continue;
        if (isOpen(w)) return true;
      }
      return false;
    }

    case "command": {
      const list = thread.contextWindows ?? [];
      // 先做一次按 id 的 parent 索引，避免 O(n²)；通常 windows 量级小，O(n) 也无妨。
      const byId = new Map<string, ContextWindow>();
      for (const w of list) byId.set(w.id, w);

      for (const w of list) {
        if (w.type !== "command_exec") continue;
        const form = w as CommandExecWindow;
        if (form.command !== trigger.command) continue;
        // form 必须 open 才视为"该 command 当前活跃"——success/failed 不算
        if (!isOpen(form)) continue;
        const parentType = parentTypeOf(form, byId);
        if (parentType === trigger.windowType) return true;
      }
      return false;
    }
  }
}

/** ContextWindow 是否算作"open"——`status === "open"` 或 status 缺省。 */
function isOpen(w: ContextWindow): boolean {
  return w.status === "open" || w.status === undefined;
}

/** form 的 parent window type；parentWindowId === "root" 或 missing 时视为 "root"。 */
function parentTypeOf(
  form: CommandExecWindow,
  byId: Map<string, ContextWindow>,
): string {
  const pid = form.parentWindowId;
  if (!pid || pid === "root") return "root";
  const parent = byId.get(pid);
  return parent?.type ?? "root";
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
