/**
 * TOML 解析器 (G5, Phase 2)
 *
 * 解析 LLM 输出的 TOML 格式。
 * 支持流式解析，适用于前端实时渲染。
 *
 * @ref docs/哲学文档/gene.md#G5 — references — Context 格式化
 */

import { parse } from "smol-toml";

/** 解析结果类型 */
export interface ParsedOutput {
  /** 思考内容 */
  thought?: string;
  /** 程序执行（代码） */
  program?: ProgramSection;
  /** 消息发送 */
  talk?: TalkSection;
  /** 动作/工具调用 */
  actions?: ActionSection[];
  /** 指令 */
  directives?: Directives;
  /** 认知栈操作 */
  cognize_stack_frame_push?: CognizeStackPushSection;
  cognize_stack_frame_pop?: CognizeStackPopSection;
  reflect_stack_frame_push?: ReflectStackFramePushSection;
  reflect_stack_frame_pop?: ReflectStackFramePopSection;
  set_plan?: string;
}

/** program 段 */
export interface ProgramSection {
  /** 语言类型，默认 javascript */
  lang?: "javascript" | "shell" | "typescript";
  /** 代码内容 */
  code: string;
}

/** talk 段 */
export interface TalkSection {
  /** 目标对象 */
  target: string;
  /** 消息内容 */
  message: string;
  /** 回复哪条消息（可选） */
  reply_to?: string;
}

/** action 段（结构化工具调用） */
export interface ActionSection {
  /** 工具名称 */
  tool: string;
  /** 参数 */
  params: Record<string, unknown>;
}

/** 指令段 */
export interface Directives {
  finish?: boolean;
  wait?: boolean;
  break?: boolean;
}

/** 认知栈帧推入 */
export interface CognizeStackPushSection {
  title: string;
  description?: string;
  traits?: string[];
  outputs?: string[];
  output_description?: string;
}

/** 认知栈帧弹出 */
export interface CognizeStackPopSection {
  summary?: string;
  artifacts?: Record<string, unknown>;
}

/** 反思栈帧推入 */
export interface ReflectStackFramePushSection {
  title?: string;
  description?: string;
}

/** 反思栈帧弹出 */
export interface ReflectStackPopSection {
  summary?: string;
}

/**
 * 解析完整的 TOML 输出字符串
 *
 * @param tomlString - LLM 输出的 TOML 格式字符串
 * @returns 解析后的结构化对象
 */
export function parseOutput(tomlString: string): ParsedOutput {
  try {
    const parsed = parse(tomlString) as Record<string, unknown>;
    const result: ParsedOutput = {};

    // 解析 thought 段
    if (parsed.thought && typeof parsed.thought === "object") {
      const thought = parsed.thought as Record<string, unknown>;
      if (typeof thought.content === "string") {
        result.thought = thought.content;
      }
    }

    // 解析 program 段
    if (parsed.program && typeof parsed.program === "object") {
      const prog = parsed.program as Record<string, unknown>;
      result.program = {
        code: typeof prog.code === "string" ? prog.code : "",
      };
      if (typeof prog.lang === "string") {
        result.program.lang = prog.lang as ProgramSection["lang"];
      }
    }

    // 解析 talk 段
    if (parsed.talk && typeof parsed.talk === "object") {
      const talk = parsed.talk as Record<string, unknown>;
      result.talk = {
        target: typeof talk.target === "string" ? talk.target : "",
        message: typeof talk.message === "string" ? talk.message : "",
      };
      if (typeof talk.reply_to === "string") {
        result.talk.reply_to = talk.reply_to;
      }
    }

    // 解析指令 (finish, wait, break)
    const directives: Directives = {};
    if (parsed.finish === true || parsed.finish === "true") {
      directives.finish = true;
    }
    if (parsed.wait === true || parsed.wait === "true") {
      directives.wait = true;
    }
    if (parsed.break === true || parsed.break === "true") {
      directives.break = true;
    }
    if (Object.keys(directives).length > 0) {
      result.directives = directives;
    }

    // 解析 cognize_stack_frame_push
    if (parsed.cognize_stack_frame_push && typeof parsed.cognize_stack_frame_push === "object") {
      const push = parsed.cognize_stack_frame_push as Record<string, unknown>;
      result.cognize_stack_frame_push = {
        title: typeof push.title === "string" ? push.title : "",
      };
      if (typeof push.description === "string") {
        result.cognize_stack_frame_push.description = push.description;
      }
      if (Array.isArray(push.traits)) {
        result.cognize_stack_frame_push.traits = push.traits as string[];
      }
      if (Array.isArray(push.outputs)) {
        result.cognize_stack_frame_push.outputs = push.outputs as string[];
      }
      if (typeof push.output_description === "string") {
        result.cognize_stack_frame_push.output_description = push.output_description;
      }
    }

    // 解析 cognize_stack_frame_pop
    if (parsed.cognize_stack_frame_pop && typeof parsed.cognize_stack_frame_pop === "object") {
      const pop = parsed.cognize_stack_frame_pop as Record<string, unknown>;
      result.cognize_stack_frame_pop = {};
      if (typeof pop.summary === "string") {
        result.cognize_stack_frame_pop.summary = pop.summary;
      }
      if (typeof pop.artifacts === "object" && pop.artifacts !== null) {
        result.cognize_stack_frame_pop.artifacts = pop.artifacts as Record<string, unknown>;
      }
    }

    // 解析 set_plan
    if (typeof parsed.set_plan === "string") {
      result.set_plan = parsed.set_plan;
    }

    return result;
  } catch (err) {
    // 解析失败时，尝试做最小程度的解析
    return parseOutputFallback(tomlString);
  }
}

/**
 * 降级解析方案
 * 当完整 TOML 解析失败时使用
 */
function parseOutputFallback(tomlString: string): ParsedOutput {
  const result: ParsedOutput = {};

  // 简单的行级解析
  const lines = tomlString.split("\n");
  let currentSection = "";
  let sectionContent: string[] = [];

  for (const line of lines) {
    // 检测段头 [section]
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      // 保存之前的段
      if (currentSection && sectionContent.length > 0) {
        applySectionContent(result, currentSection, sectionContent.join("\n"));
      }
      currentSection = sectionMatch[1];
      sectionContent = [];
      continue;
    }

    if (currentSection) {
      sectionContent.push(line);
    }
  }

  // 保存最后一个段
  if (currentSection && sectionContent.length > 0) {
    applySectionContent(result, currentSection, sectionContent.join("\n"));
  }

  return result;
}

/**
 * 应用段内容到结果对象
 */
function applySectionContent(result: ParsedOutput, section: string, content: string): void {
  const trimmed = content.trim();

  switch (section) {
    case "thought":
      result.thought = extractKeyValue(trimmed, "content") || trimmed;
      break;
    case "program":
      result.program = {
        code: extractKeyValue(trimmed, "code") || trimmed,
      };
      break;
    case "talk":
      result.talk = {
        target: extractKeyValue(trimmed, "target") || "",
        message: extractKeyValue(trimmed, "message") || trimmed,
      };
      break;
    case "finish":
      result.directives = result.directives || {};
      result.directives.finish = true;
      break;
    case "wait":
      result.directives = result.directives || {};
      result.directives.wait = true;
      break;
    case "break":
      result.directives = result.directives || {};
      result.directives.break = true;
      break;
  }
}

/**
 * 从文本中提取 key=value 或 key = """multiline""" 格式的值
 */
function extractKeyValue(text: string, key: string): string | undefined {
  // 尝试匹配多行字符串格式
  const multiLinePattern = new RegExp(`^\\s*${key}\\s*=\\s*'''([\\s\\S]*?)'''`, "m");
  const multiMatch = text.match(multiLinePattern);
  if (multiMatch) {
    return multiMatch[1];
  }

  // 尝试匹配普通字符串
  const singleLinePattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`);
  const singleMatch = text.match(singleLinePattern);
  if (singleMatch) {
    return singleMatch[1];
  }

  return undefined;
}

/**
 * 流式解析状态
 */
export interface StreamParseState {
  buffer: string;
  currentSection: string;
  currentContent: string[];
}

/**
 * 创建流式解析器
 * 用于前端逐段渲染 LLM 输出
 */
export function createStreamParser(): {
  state: StreamParseState;
  push: (chunk: string) => Array<{ type: string; content?: string }>;
  done: () => Array<{ type: string; content?: string }>;
} {
  const state: StreamParseState = {
    buffer: "",
    currentSection: "",
    currentContent: [],
  };

  const events: Array<{ type: string; content?: string }> = [];

  function push(chunk: string): Array<{ type: string; content?: string }> {
    const newEvents: Array<{ type: string; content?: string }> = [];
    state.buffer += chunk;

    // 逐行处理
    const lines = state.buffer.split("\n");
    // 保留最后一行（可能不完整）
    state.buffer = lines.pop() || "";

    for (const line of lines) {
      // 检测段头
      const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (sectionMatch) {
        // 输出当前段
        if (state.currentSection && state.currentContent.length > 0) {
          newEvents.push({
            type: state.currentSection,
            content: state.currentContent.join("\n"),
          });
          events.push({
            type: state.currentSection,
            content: state.currentContent.join("\n"),
          });
        }
        state.currentSection = sectionMatch[1];
        state.currentContent = [];

        // 对于简单指令段（finish, wait, break），直接输出事件
        if (["finish", "wait", "break"].includes(state.currentSection)) {
          newEvents.push({ type: state.currentSection });
          events.push({ type: state.currentSection });
        }
        continue;
      }

      if (state.currentSection) {
        state.currentContent.push(line);
      }
    }

    return newEvents;
  }

  function done(): Array<{ type: string; content?: string }> {
    const newEvents: Array<{ type: string; content?: string }> = [];

    // 处理剩余的 buffer
    if (state.buffer.trim()) {
      const sectionMatch = state.buffer.match(/^\s*\[([^\]]+)\]\s*$/);
      if (sectionMatch) {
        newEvents.push({ type: sectionMatch[1] });
        events.push({ type: sectionMatch[1] });
      } else if (state.currentSection) {
        state.currentContent.push(state.buffer);
      }
    }

    // 输出最后一个段
    if (state.currentSection && state.currentContent.length > 0) {
      newEvents.push({
        type: state.currentSection,
        content: state.currentContent.join("\n"),
      });
      events.push({
        type: state.currentSection,
        content: state.currentContent.join("\n"),
      });
    }

    return newEvents;
  }

  return { state, push, done };
}
