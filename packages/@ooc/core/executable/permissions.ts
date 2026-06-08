/**
 * Permission 模型 (Q0b) — method 级三档准入控制。
 *
 * Design:        docs/2026-05-25-permission-model-design.md
 * Meta 概念:     meta/object.doc.ts:executable.children.permission
 *
 * 三档语义:
 * - "allow" → 直接执行 (默认)
 * - "ask"   → HITL: 写 permission_ask ProcessEvent + thread.status="paused"
 * - "deny"  → 系统拒绝: 写 permission_denied ProcessEvent + 合成 function_call_output
 *
 * 决策链 (优先级从高到低):
 * 1. PermissionDecider (escape hatch; 由测试 fixture 或控制面通过 setPermissionDecider 注入)
 * 2. stones/<self>/objects/<id>/config/policies.json -> methods[<method>]
 * 3. ObjectMethod.permission (各 method 作者声明)
 * 4. 缺省 → "allow"
 *
 * 不变量:
 * - 配置文件错误容错: 缺失 / JSON 错 / 字段拼错 → 全部 fallback, 永不抛崩溃
 * - silent-swallow ban: 调用方 (thinkloop) 必须把每条 ask / deny 决策落 ProcessEvent
 * - 向后兼容: 未声明 permission 的 method 维持原 allow 行为
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getPermissionDecider } from "../observable";
import { deriveStoneFromThread, stoneDir } from "../persistable/common";
import type { ThreadContext } from "../thinkable/context";
import type { ObjectRegistry } from "./windows/_shared/registry";
import { builtinRegistry } from "./windows/index.js";

/** 单档准入级别。 */
export type PermissionLevel = "allow" | "ask" | "deny";

/** decidePermission 的结构化返回。 */
export type PermissionDecision =
  | { decision: "allow" }
  | { decision: "ask" }
  | { decision: "deny"; reason: string };

/**
 * thinkloop 在分派 tool call 前组装的待审计载荷。
 *
 * - exec: method = args.method (实际 OOC method 名); windowId = args.window_id (目标 window);
 *   args = args.args (method 的业务参数)
 * - close / wait / compress: method = toolName 自身; windowId / args 视情况填
 */
export type PendingToolCall = {
  /** 触发的 LLM tool 原语名。 */
  toolName: "exec" | "close" | "wait" | "compress";
  /**
   * 对 exec: 解析自 args.method 的 method 路径 (例如 "talk", "write_file")。
   * 对 close/wait/compress: 等于 toolName。
   */
  method?: string;
  /** 调用的原始 args (透传给 decider, 便于 escape hatch 做精细判断)。 */
  args?: unknown;
  /** 对 exec: 目标 window id (例如 "root" 或 form_id); 其他 tool 视情况填。 */
  windowId?: string;
};

/** PermissionDecider — escape hatch; 优先级高于 policies.json 与 ObjectMethod。 */
export type PermissionDecider = (
  thread: ThreadContext,
  call: PendingToolCall,
) => PermissionDecision | Promise<PermissionDecision>;

interface PoliciesFile {
  methods?: Record<string, unknown>;
}

/**
 * 读取 stone 上的 policies.json; 返回 method -> level 的扁平 map。
 *
 * - thread.persistence 缺失 → {}
 * - 路径不存在 → {}
 * - JSON 解析失败 → {}
 * - methods 字段拼错或类型错 → {}
 * - 单个 method 的 level 不是合法 PermissionLevel → 跳过该项
 *
 * 永不抛错 (invariant #5)。
 */
export function loadPoliciesJson(thread: ThreadContext): Record<string, PermissionLevel> {
  if (!thread.persistence) return {};

  let configPath: string;
  try {
    const stoneRef = deriveStoneFromThread(thread.persistence);
    configPath = join(stoneDir(stoneRef), "config", "policies.json");
  } catch {
    return {};
  }

  if (!existsSync(configPath)) return {};

  let parsed: unknown;
  try {
    const raw = readFileSync(configPath, "utf8");
    if (!raw.trim()) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const file = parsed as PoliciesFile;
  const commands = file.methods;
  if (!commands || typeof commands !== "object" || Array.isArray(commands)) return {};

  const result: Record<string, PermissionLevel> = {};
  for (const [name, value] of Object.entries(commands)) {
    if (value === "allow" || value === "ask" || value === "deny") {
      result[name] = value;
    }
  }
  return result;
}

/**
 * 在 WindowRegistry 中查找声明在 ObjectMethod.permission 上的级别。
 *
 * 查找路径 (优先匹配可能的具体 window type, 失败则尝试 root):
 * - 如果 call 指定了 windowId 且能在 thread.contextWindows 中找到该 window,
 *   优先查它的 type definition.methods[method].permission
 * - 否则查 root 的 methods[method].permission
 * - 找不到 entry / 字段缺失 → undefined (调用方 fallback 到 allow)
 */
function lookupDeclaredPermission(
  thread: ThreadContext,
  call: PendingToolCall,
  registry: ObjectRegistry,
): PermissionLevel | undefined {
  const methodName = call.method;
  if (!methodName) return undefined;

  const tryWindow = (windowType: string): PermissionLevel | undefined => {
    try {
      const def = registry.getObjectDefinition(windowType as never);
      const entry = def.methods[methodName];
      const fn = entry?.permission;
      if (!fn) return undefined;
      try {
        const args = call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? (call.args as Record<string, unknown>)
          : {};
        return fn(args);
      } catch {
        return undefined;
      }
    } catch {
      return undefined;
    }
  };

  if (call.windowId) {
    const target = thread.contextWindows?.find((w) => w.id === call.windowId);
    if (target) {
      const fromTarget = tryWindow(target.type);
      if (fromTarget) return fromTarget;
    }
  }
  // fallback: root window 表
  return tryWindow("root");
}

/**
 * 计算单个 tool call 的最终准入决定。
 *
 * 决策链 (优先级从高到低):
 * 1. PermissionDecider (若已通过 setPermissionDecider 注入)
 * 2. policies.json 中的 methods[<method>]
 * 3. ObjectMethod.permission
 * 4. 默认 "allow"
 */
export async function decidePermission(
  thread: ThreadContext,
  call: PendingToolCall,
  registry: ObjectRegistry = builtinRegistry,
): Promise<PermissionDecision> {
  // 1. 注入的 decider 优先 — escape hatch
  const decider = getPermissionDecider();
  if (decider) {
    try {
      const result = await decider(thread, call);
      if (result && typeof result === "object" && "decision" in result) {
        return result;
      }
    } catch {
      // decider 自身抛错时退到下一级 (silent-swallow ban 由 thinkloop 的 ask/deny 落地保证;
      // decider 异常不应阻塞 think 一轮)。
    }
  }

  // 2. policies.json 覆盖
  if (call.method) {
    const policies = loadPoliciesJson(thread);
    const fromPolicies = policies[call.method];
    if (fromPolicies) {
      return levelToDecision(fromPolicies, "policies.json");
    }
  }

  // 3. ObjectMethod 声明
  const declared = lookupDeclaredPermission(thread, call, registry);
  if (declared) {
    return levelToDecision(declared, "ObjectMethod.permission");
  }

  // 4. 默认放行
  return { decision: "allow" };
}

function levelToDecision(level: PermissionLevel, source: string): PermissionDecision {
  if (level === "allow") return { decision: "allow" };
  if (level === "ask") return { decision: "ask" };
  return { decision: "deny", reason: `denied by ${source}` };
}
