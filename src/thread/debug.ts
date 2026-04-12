/**
 * 线程 Debug 记录器
 *
 * 在 debug 模式下，持久化每轮 ThinkLoop 的 LLM 输入/输出和元数据。
 * 文件写入线程目录下的 debug/ 子目录。
 *
 * @ref docs/superpowers/specs/2026-04-11-observability-framework-design.md
 */

import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Message } from "../thinkable/client.js";

/** Debug 元数据 */
export interface DebugMeta {
  loop: number;
  timestamp: number;
  threadId: string;
  objectName: string;
  source: "llm" | "cached";
  llm: {
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  context: {
    totalChars: number;
    totalMessageChars: number;
    sections: Record<string, number>;
  };
  activeTraits: string[];
  activeSkills: string[];
  parsedDirectives: string[];
}

/** writeDebugLoop 的参数 */
export interface WriteDebugLoopParams {
  debugDir: string;
  loopIndex: number;
  messages: Message[];
  llmOutput: string;
  thinkingContent?: string;
  source: "llm" | "cached";
  llmMeta: {
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  contextStats: { totalChars: number; totalMessageChars: number; sections: Record<string, number> };
  activeTraits: string[];
  activeSkills: string[];
  parsedDirectives: string[];
  threadId: string;
  objectName: string;
}

/**
 * 记录一轮 ThinkLoop 的 debug 数据
 *
 * 生成文件：
 * - loop_NNN.input.txt — LLM 输入（Messages 格式）
 * - loop_NNN.output.txt — LLM 原始输出
 * - loop_NNN.thinking.txt — thinking 输出（如有）
 * - loop_NNN.meta.json — 结构化元数据
 */
export function writeDebugLoop(params: WriteDebugLoopParams): void {
  const {
    debugDir, loopIndex, messages, llmOutput, thinkingContent,
    source, llmMeta, contextStats, activeTraits, activeSkills,
    parsedDirectives, threadId, objectName,
  } = params;

  mkdirSync(debugDir, { recursive: true });

  const prefix = `loop_${String(loopIndex).padStart(3, "0")}`;

  /* input.txt */
  const inputContent = messages
    .map(m => `--- ${m.role} ---\n${m.content}`)
    .join("\n\n");
  writeFileSync(join(debugDir, `${prefix}.input.txt`), inputContent, "utf-8");

  /* output.txt */
  writeFileSync(join(debugDir, `${prefix}.output.txt`), llmOutput, "utf-8");

  /* thinking.txt（仅当有内容时） */
  if (thinkingContent) {
    writeFileSync(join(debugDir, `${prefix}.thinking.txt`), thinkingContent, "utf-8");
  }

  /* meta.json */
  const meta: DebugMeta = {
    loop: loopIndex,
    timestamp: Date.now(),
    threadId,
    objectName,
    source,
    llm: llmMeta,
    context: contextStats,
    activeTraits,
    activeSkills,
    parsedDirectives,
  };
  writeFileSync(join(debugDir, `${prefix}.meta.json`), JSON.stringify(meta, null, 2), "utf-8");
}

/** Context 统计结果 */
export interface ContextStats {
  totalChars: number;
  sections: Record<string, number>;
}

/**
 * 从 ThreadContext 计算各区域字符数统计
 *
 * 统计 ThreadContext 原始字段的字符数（不含 contextToMessages 拼接的标记文本）。
 */
export function computeContextStats(ctx: {
  whoAmI: string;
  instructions: Array<{ content: string }>;
  knowledge: Array<{ content: string }>;
  process: string;
  plan: string;
  parentExpectation: string;
  childrenSummary: string;
  ancestorSummary: string;
  siblingSummary: string;
  inbox: unknown[];
  todos: unknown[];
  directory: unknown[];
  locals: Record<string, unknown>;
}): ContextStats {
  const sections: Record<string, number> = {};

  sections.whoAmI = ctx.whoAmI.length;
  sections.instructions = ctx.instructions.reduce((sum, w) => sum + w.content.length, 0);
  sections.knowledge = ctx.knowledge.reduce((sum, w) => sum + w.content.length, 0);
  sections.process = ctx.process.length;
  sections.plan = ctx.plan.length;
  sections.parentExpectation = ctx.parentExpectation.length;
  sections.childrenSummary = ctx.childrenSummary.length;
  sections.ancestorSummary = ctx.ancestorSummary.length;
  sections.siblingSummary = ctx.siblingSummary.length;
  sections.inbox = JSON.stringify(ctx.inbox).length;
  sections.todos = JSON.stringify(ctx.todos).length;
  sections.directory = JSON.stringify(ctx.directory).length;
  sections.locals = JSON.stringify(ctx.locals).length;

  const totalChars = Object.values(sections).reduce((sum, v) => sum + v, 0);

  return { totalChars, sections };
}

/**
 * 从 ThreadIterationResult 提取解析出的指令类型
 *
 * 遍历 iterResult 的关键字段，收集非 null/undefined 的字段名。
 */
export function extractDirectiveTypes(iterResult: Record<string, unknown>): string[] {
  const directiveFields = [
    "program", "talks", "useSkill", "newChildNode", "threadReturn",
    "awaitingChildren", "continueSubThread", "planUpdate",
    "formBegin", "formSubmit", "formCancel",
  ];
  /* thought 在 newActions 中 */
  const result: string[] = [];
  const actions = iterResult.newActions as Array<{ type: string }> | undefined;
  if (actions?.some(a => a.type === "thought")) result.push("thought");
  if (actions?.some(a => a.type === "set_plan")) result.push("set_plan");

  for (const field of directiveFields) {
    const val = iterResult[field];
    if (val !== null && val !== undefined) {
      result.push(field);
    }
  }
  return result;
}

/**
 * 获取 debug 目录下已有的 loop 数量（用于 resume 场景初始化计数器）
 */
export function getExistingLoopCount(debugDir: string): number {
  if (!existsSync(debugDir)) return 0;
  try {
    const files = readdirSync(debugDir);
    const metaFiles = files.filter(f => f.endsWith(".meta.json"));
    return metaFiles.length;
  } catch {
    return 0;
  }
}
