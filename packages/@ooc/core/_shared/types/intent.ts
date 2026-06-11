/**
 * Intent = "what this form is currently doing" —— canonical 源（从
 * `thinkable/context/intent.ts` 迁入）。零依赖纯类型 + 纯函数。
 *
 * method name itself is always an implicit intent ("program", "open_file").
 * Sub-task disambiguation adds extra intents ("program.shell", "program.typescript").
 */
export interface Intent {
  name: string;
  tags?: Record<string, unknown>;
}

/**
 * Parameter schema for a method call. Optional; enables structured fill_state rendering
 * and fail-soft refine validation. All fields are optional.
 */
export interface MethodCallSchema {
  args: Record<string, MethodArgSpec>;
}

export interface MethodArgSpec {
  type: "string" | "number" | "boolean" | "array" | "object" | "any";
  required?: boolean;
  default?: unknown;
  description?: string;
  enum?: Array<string | number | boolean>;
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minimum?: number;
    maximum?: number;
    customMessage?: string;
  };
}

/**
 * A change event dispatched to onFormChange when the form's state meaningfully changes.
 * Three kinds: args_refined (parameters changed), status_changed (form lifecycle),
 * intent_changed (the semantic intent set changed).
 */
export type FormChangeEvent =
  | {
      kind: "args_refined";
      added: string[];
      removed: string[];
      changed: string[];
      args: Record<string, unknown>;
    }
  | {
      kind: "status_changed";
      from: "open" | "executing" | "success" | "failed";
      to: "open" | "executing" | "success" | "failed";
    }
  | {
      kind: "intent_changed";
      from: Intent[];
      to: Intent[];
    };

/**
 * Cache keyed by formId, holding the last-computed intent + derived windows for that form.
 * Managed by the write path (manager.openMethodExec / refine / submit) and read by
 * ContextPipeline. Stored in ThreadContext.
 */
export interface IntentCacheEntry {
  argsHash: string;
  status: "open" | "executing" | "success" | "failed";
  intents: Intent[];
}

export type IntentCache = Map<string, IntentCacheEntry>;

/** Stable hash of accumulatedArgs (sorted keys) for cache invalidation. */
export function hashArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const parts: string[] = [];
  for (const k of keys) {
    let v: string;
    try {
      v = JSON.stringify(args[k]);
    } catch {
      // intentional: 不可序列化值（含循环引用 / BigInt）回退到 String()，hash 仍稳定
      v = String(args[k]);
    }
    parts.push(`${k}:${v}`);
  }
  return parts.join("|");
}

/**
 * Diff two args objects. Used when emitting the args_refined FormChangeEvent.
 * Returns { added, removed, changed } lists of arg names.
 */
export function diffArgs(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const allKeys = new Set<string>();
  Object.keys(prev).forEach((k) => allKeys.add(k));
  Object.keys(next).forEach((k) => allKeys.add(k));
  allKeys.forEach((k) => {
    const inPrev = k in prev;
    const inNext = k in next;
    if (inPrev && !inNext) removed.push(k);
    else if (!inPrev && inNext) added.push(k);
    else if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) changed.push(k);
  });
  return { added, removed, changed };
}
