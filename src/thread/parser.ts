/**
 * 线程指令解析器
 *
 * 从 LLM 输出中提取线程树 API 指令。
 * 复用旧 TOML 解析基础设施，新增 create_sub_thread / return / await 等指令。
 *
 * 与旧 parser 的区别：
 * - 删除：cognize_stack_frame_push/pop, reflect_stack_frame_push/pop, finish, wait, break
 * - 新增：create_sub_thread, return, await, await_all, mark, addTodo
 * - 保留：thought, program, talk, set_plan, action
 *
 * @ref docs/superpowers/specs/2026-04-06-thread-tree-architecture-design.md#4
 */

import type { ProgramSection, TalkSection, ActionSection } from "../toml/parser.js";
import { parse as parseToml } from "smol-toml";

/** create_sub_thread 指令 */
export interface CreateSubThreadDirective {
  title: string;
  description?: string;
  traits?: string[];
}

/** return 指令 */
export interface ThreadReturnDirective {
  summary: string;
  artifacts?: Record<string, unknown>;
}

/** mark 指令 */
export interface MarkDirective {
  messageId: string;
  type: "ack" | "ignore" | "todo";
  tip: string;
}

/** addTodo 指令 */
export interface AddTodoDirective {
  content: string;
  sourceMessageId?: string;
}

/** 线程输出解析结果 */
export interface ThreadParsedOutput {
  /** 思考内容 */
  thought?: string;
  /** 程序执行 */
  program: ProgramSection | null;
  /** 对话 */
  talk: TalkSection | null;
  /** 工具调用 */
  actions: ActionSection[];
  /** 创建子线程 */
  createSubThread: CreateSubThreadDirective | null;
  /** 线程返回 */
  threadReturn: ThreadReturnDirective | null;
  /** 等待子线程（单个或多个） */
  awaitThreads: string[] | null;
  /** 处理 inbox 消息 */
  mark: MarkDirective | null;
  /** 创建待办 */
  addTodo: AddTodoDirective | null;
  /** 更新计划 */
  setPlan: string | null;
}

/**
 * 解析线程 LLM 输出
 *
 * 单次 TOML 解析，从同一个解析结果中提取旧指令（thought/program/talk）和新指令
 * （create_sub_thread/return/await 等）。避免双重解析的性能浪费。
 *
 * @param output - LLM 原始输出文本
 * @returns 结构化的线程指令
 */
export function parseThreadOutput(output: string): ThreadParsedOutput {
  const result: ThreadParsedOutput = {
    thought: undefined,
    program: null,
    talk: null,
    actions: [],
    createSubThread: null,
    threadReturn: null,
    awaitThreads: null,
    mark: null,
    addTodo: null,
    setPlan: null,
  };

  /* 单次 TOML 解析 */
  const parsed = safeParseToml(output);
  if (!parsed) return result;

  /* === 旧指令（复用旧 parser 的提取逻辑，但从同一个解析结果中读取） === */

  /* thought */
  if (parsed.thought && typeof parsed.thought === "object") {
    const t = parsed.thought as Record<string, unknown>;
    if (typeof t.content === "string") result.thought = t.content;
  }

  /* program */
  if (parsed.program && typeof parsed.program === "object") {
    const p = parsed.program as Record<string, unknown>;
    result.program = { code: typeof p.code === "string" ? p.code : "" } as ProgramSection;
  }

  /* talk */
  if (parsed.talk && typeof parsed.talk === "object") {
    const t = parsed.talk as Record<string, unknown>;
    result.talk = {
      target: typeof t.target === "string" ? t.target : "",
      message: typeof t.message === "string" ? t.message : "",
    } as TalkSection;
  }

  /* set_plan */
  if (parsed.set_plan && typeof parsed.set_plan === "object") {
    const sp = parsed.set_plan as Record<string, unknown>;
    if (typeof sp.text === "string") result.setPlan = sp.text;
  }

  /* === 新指令 === */

  /* create_sub_thread */
  if (parsed.create_sub_thread && typeof parsed.create_sub_thread === "object") {
    const cst = parsed.create_sub_thread as Record<string, unknown>;
    result.createSubThread = {
      title: typeof cst.title === "string" ? cst.title : "",
    };
    if (typeof cst.description === "string") {
      result.createSubThread.description = cst.description;
    }
    if (Array.isArray(cst.traits)) {
      result.createSubThread.traits = cst.traits as string[];
    }
  }

  /* return */
  if (parsed.return && typeof parsed.return === "object") {
    const ret = parsed.return as Record<string, unknown>;
    result.threadReturn = {
      summary: typeof ret.summary === "string" ? ret.summary : "",
    };
    if (typeof ret.artifacts === "object" && ret.artifacts !== null) {
      result.threadReturn.artifacts = ret.artifacts as Record<string, unknown>;
    }
  }

  /* await（单个） */
  if (parsed.await && typeof parsed.await === "object") {
    const aw = parsed.await as Record<string, unknown>;
    if (typeof aw.thread_id === "string") {
      result.awaitThreads = [aw.thread_id];
    }
  }

  /* await_all（多个） */
  if (parsed.await_all && typeof parsed.await_all === "object") {
    const awa = parsed.await_all as Record<string, unknown>;
    if (Array.isArray(awa.thread_ids)) {
      result.awaitThreads = awa.thread_ids as string[];
    }
  }

  /* mark */
  if (parsed.mark && typeof parsed.mark === "object") {
    const m = parsed.mark as Record<string, unknown>;
    result.mark = {
      messageId: typeof m.message_id === "string" ? m.message_id : "",
      type: (typeof m.type === "string" ? m.type : "ack") as "ack" | "ignore" | "todo",
      tip: typeof m.tip === "string" ? m.tip : "",
    };
  }

  /* addTodo */
  if (parsed.addTodo && typeof parsed.addTodo === "object") {
    const td = parsed.addTodo as Record<string, unknown>;
    result.addTodo = {
      content: typeof td.content === "string" ? td.content : "",
    };
    if (typeof td.source_message_id === "string") {
      result.addTodo.sourceMessageId = td.source_message_id;
    }
  }

  return result;
}

/**
 * 安全解析 TOML（失败返回 null）
 */
function safeParseToml(text: string): Record<string, unknown> | null {
  try {
    /* 去掉 toml fence */
    const trimmed = text.trim();
    const match = trimmed.match(/^```(?:toml)?\s*\n([\s\S]*?)\n```$/i);
    const raw = match?.[1] ?? text;

    return parseToml(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
