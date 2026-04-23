/**
 * Test Failure Bridge —— 将 runner 的失败事件桥接到 world.talk
 *
 * 作用：订阅 runner 的 subscribeFailures 事件，把每一批失败包装成
 *       `[test_failure] ...` 文本并 talk 给指定 stone（默认 supervisor）。
 *
 * 设计：
 * - 只在 `OOC_TEST_FAILURE_BRIDGE=1` 时启用（默认关）
 * - 收件人通过 `OOC_TEST_FAILURE_RECIPIENT` 指定；未指定则按优先级查找
 *   `supervisor` → `alan` → 第一个注册 stone，找不到则跳过投递
 * - 同时保证 talk 失败不抛（日志降级），避免影响主循环
 *
 * @ref docs/工程管理/迭代/all/20260422_feature_feedback_loop_完整闭环.md
 */

import { consola } from "consola";
import type { TestFailure } from "../test/runner.js";
import { subscribeFailures } from "../test/runner.js";

/** Stone 查询接口（world 传入） */
export interface StoneLookup {
  /** 已注册对象名列表 */
  names: () => string[];
  /** 判断对象是否存在 */
  has: (name: string) => boolean;
}

/** talk 投递接口（world 传入） */
export type TalkDeliverer = (recipient: string, message: string) => Promise<unknown>;

/** 桥配置 */
export interface BridgeConfig {
  /** 环境变量覆盖（测试传） */
  enableFlag?: string;
  /** 显式指定收件人，覆盖默认查找规则 */
  recipient?: string;
}

/** 格式化一组失败为 talk 消息内容 */
export function formatFailuresAsTalkMessage(
  failures: readonly TestFailure[],
  cwd: string,
): string {
  const header = `[test_failure] ${failures.length} 条测试失败（cwd=${cwd}）`;
  const lines: string[] = [header, ""];
  for (const f of failures.slice(0, 10)) {
    const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "?";
    lines.push(`- ${f.name}（${loc}）`);
    if (f.message) lines.push(`  error: ${f.message}`);
  }
  if (failures.length > 10) {
    lines.push(`... 另有 ${failures.length - 10} 条未列出`);
  }
  return lines.join("\n");
}

/**
 * 从候选列表 + 环境变量挑一个可用收件人
 *
 * 查找顺序：
 * 1. 显式 recipient 参数
 * 2. 环境变量 OOC_TEST_FAILURE_RECIPIENT
 * 3. "supervisor"
 * 4. "alan"
 * 5. 已注册对象中第一个非 user
 */
export function pickRecipient(lookup: StoneLookup, explicit?: string): string | null {
  if (explicit && lookup.has(explicit)) return explicit;
  const envPick = process.env.OOC_TEST_FAILURE_RECIPIENT;
  if (envPick && lookup.has(envPick)) return envPick;
  if (lookup.has("supervisor")) return "supervisor";
  if (lookup.has("alan")) return "alan";
  for (const n of lookup.names()) {
    if (n !== "user") return n;
  }
  return null;
}

/**
 * 启动 runner → world 失败桥
 *
 * @returns 卸载函数（停止订阅）
 */
export function startTestFailureBridge(params: {
  lookup: StoneLookup;
  talk: TalkDeliverer;
  config?: BridgeConfig;
}): () => void {
  const enabled = (params.config?.enableFlag ?? process.env.OOC_TEST_FAILURE_BRIDGE) === "1";
  if (!enabled) {
    return () => {};
  }
  const unsubscribe = subscribeFailures((failures, cwd) => {
    if (failures.length === 0) return;
    const recipient = pickRecipient(params.lookup, params.config?.recipient);
    if (!recipient) {
      consola.warn("[test_failure_bridge] 无可用收件人，丢弃失败事件");
      return;
    }
    const msg = formatFailuresAsTalkMessage(failures, cwd);
    /* talk 失败不抛：失败只是日志降级；主循环 / test watch 必须继续 */
    void params.talk(recipient, msg).catch((err) => {
      consola.error(`[test_failure_bridge] 投递失败（recipient=${recipient}）:`, err);
    });
  });
  consola.info("[test_failure_bridge] 已启用（OOC_TEST_FAILURE_BRIDGE=1）");
  return unsubscribe;
}
