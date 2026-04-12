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
  /** 从哪个线程派生（可选，不填则从当前线程派生） */
  deriveFrom?: string;
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

/** use_skill 指令 */
export interface UseSkillDirective {
  name: string;
}

/** form begin 指令 */
export interface FormBeginDirective {
  command: string;
  description: string;
}

/** form submit 指令 */
export interface FormSubmitDirective {
  command: string;
  formId: string;
  params: Record<string, unknown>;
}

/** form cancel 指令 */
export interface FormCancelDirective {
  command: string;
  formId: string;
}

/** continue_sub_thread 指令（向已创建的子线程追加消息） */
export interface ContinueSubThreadDirective {
  threadId: string;
  message: string;
}

/** 线程输出解析结果 */
export interface ThreadParsedOutput {
  /** 思考内容 */
  thought?: string;
  /** 程序执行 */
  program: ProgramSection | null;
  /** 异步对话 */
  talk: TalkSection | null;
  /** 同步对话（发送后自动 wait） */
  talkSync: TalkSection | null;
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
  /** 向已创建的子线程追加消息 */
  continueSubThread: ContinueSubThreadDirective | null;
  /** 更新计划 */
  setPlan: string | null;
  /** 使用 skill */
  useSkill: UseSkillDirective | null;
  /** form begin 操作 */
  formBegin: FormBeginDirective | null;
  /** form submit 操作 */
  formSubmit: FormSubmitDirective | null;
  /** form cancel 操作 */
  formCancel: FormCancelDirective | null;
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
    talkSync: null,
    actions: [],
    createSubThread: null,
    threadReturn: null,
    awaitThreads: null,
    mark: null,
    addTodo: null,
    continueSubThread: null,
    setPlan: null,
    useSkill: null,
    formBegin: null,
    formSubmit: null,
    formCancel: null,
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
    const mark = parseTalkMark(t);
    if (mark) result.talk.mark = mark;
  }

  /* talk_sync（同步 talk，发送后自动 wait） */
  if (parsed.talk_sync && typeof parsed.talk_sync === "object") {
    const t = parsed.talk_sync as Record<string, unknown>;
    result.talkSync = {
      target: typeof t.target === "string" ? t.target : "",
      message: typeof t.message === "string" ? t.message : "",
    } as TalkSection;
    const mark = parseTalkMark(t);
    if (mark) result.talkSync.mark = mark;
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
    if (typeof cst.derive_from_which_thread === "string") {
      result.createSubThread.deriveFrom = cst.derive_from_which_thread;
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

  /* continue_sub_thread */
  if (parsed.continue_sub_thread && typeof parsed.continue_sub_thread === "object") {
    const cst = parsed.continue_sub_thread as Record<string, unknown>;
    result.continueSubThread = {
      threadId: typeof cst.thread_id === "string" ? cst.thread_id : "",
      message: typeof cst.message === "string" ? cst.message : "",
    };
  }

  /* use_skill */
  if (parsed.use_skill && typeof parsed.use_skill === "object") {
    const us = parsed.use_skill as Record<string, unknown>;
    if (typeof us.name === "string" && us.name) {
      result.useSkill = { name: us.name };
    }
  }

  /* form 操作解析：TOML 中 [talk.begin] 解析为 { talk: { begin: { ... } } } */
  const formActions = ["begin", "submit", "cancel"] as const;
  for (const key of Object.keys(parsed)) {
    const section = parsed[key];
    if (!section || typeof section !== "object") continue;

    const sectionObj = section as Record<string, unknown>;
    for (const action of formActions) {
      const actionData = sectionObj[action];
      if (!actionData || typeof actionData !== "object") continue;

      const data = actionData as Record<string, unknown>;

      if (action === "begin" && !result.formBegin) {
        result.formBegin = {
          command: key,
          description: typeof data.description === "string" ? data.description : "",
        };
      } else if (action === "submit" && !result.formSubmit) {
        const formId = typeof data.form_id === "string" ? data.form_id : "";
        const params: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data)) {
          if (k !== "form_id") params[k] = v;
        }
        result.formSubmit = { command: key, formId, params };
      } else if (action === "cancel" && !result.formCancel) {
        result.formCancel = {
          command: key,
          formId: typeof data.form_id === "string" ? data.form_id : "",
        };
      }
    }
  }

  return result;
}

/**
 * 安全解析 TOML（失败返回 null）
 *
 * 三层容错策略：
 * 1. 提取所有 ```toml...``` 代码块内容合并后解析
 * 2. 剥离纯文本前缀，从第一个 `[` 开始解析
 * 3. 原始文本直接解析
 */
function safeParseToml(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  /* 策略 1：提取所有 ```toml...``` 或 ```...``` 代码块，合并内容 */
  const fencePattern = /```(?:toml)?\s*\n([\s\S]*?)```/gi;
  const blocks: string[] = [];
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fencePattern.exec(trimmed)) !== null) {
    blocks.push(fenceMatch[1]!.trim());
  }
  if (blocks.length > 0) {
    const merged = blocks.join("\n\n");
    try {
      return parseToml(merged) as Record<string, unknown>;
    } catch { /* 继续下一策略 */ }
  }

  /* 策略 2：剥离纯文本前缀，从第一个行首 `[` 开始解析（仅当文本不以 [ 开头时） */
  if (!trimmed.startsWith("[")) {
    const firstBracket = trimmed.indexOf("\n[");
    if (firstBracket >= 0) {
      const fromBracket = trimmed.slice(firstBracket + 1);
      try {
        return parseToml(fromBracket) as Record<string, unknown>;
      } catch { /* 继续下一策略 */ }
    }
  }

  /* 策略 2b：文本以 [ 开头（标准 TOML，直接解析） */
  if (trimmed.startsWith("[")) {
    try {
      return parseToml(trimmed) as Record<string, unknown>;
    } catch { /* 继续下一策略 */ }
  }

  /* 策略 3：原始文本直接解析（兜底） */
  try {
    return parseToml(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 从 [talk] / [talk_sync] 段中解析 mark 信息（可选）
 *
 * 支持两种写法：
 * 1) 扁平字段：mark_message_id / mark_type / mark_tip
 * 2) 内联表：mark = { message_id = "...", type = "ack", tip = "已回复" }
 */
function parseTalkMark(talk: Record<string, unknown>): TalkSection["mark"] | null {
  /* 1) 内联表 mark = { ... } */
  if (talk.mark && typeof talk.mark === "object") {
    const m = talk.mark as Record<string, unknown>;
    const ids: string[] = [];
    if (typeof m.message_id === "string" && m.message_id) ids.push(m.message_id);
    if (Array.isArray(m.message_ids)) {
      for (const v of m.message_ids) {
        if (typeof v === "string" && v) ids.push(v);
      }
    }

    if (ids.length > 0) {
      const mark: TalkSection["mark"] = { message_ids: ids };
      if (typeof m.type === "string") {
        const type = m.type as string;
        if (type === "ack" || type === "ignore" || type === "todo") {
          mark.type = type;
        }
      }
      if (typeof m.tip === "string") {
        mark.tip = m.tip;
      }
      return mark;
    }
  }

  /* 2) 扁平字段 */
  const ids: string[] = [];
  if (typeof talk.mark_message_id === "string" && talk.mark_message_id) {
    ids.push(talk.mark_message_id);
  }
  if (Array.isArray(talk.mark_message_ids)) {
    for (const v of talk.mark_message_ids) {
      if (typeof v === "string" && v) ids.push(v);
    }
  }
  if (ids.length > 0) {
    const mark: TalkSection["mark"] = { message_ids: ids };
    if (typeof talk.mark_type === "string") {
      const type = talk.mark_type as string;
      if (type === "ack" || type === "ignore" || type === "todo") {
        mark.type = type;
      }
    }
    if (typeof talk.mark_tip === "string") {
      mark.tip = talk.mark_tip as string;
    }
    return mark;
  }

  return null;
}
