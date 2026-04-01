/**
 * 程序提取器
 *
 * 从 LLM 输出中提取思考内容和可执行程序。
 *
 * 支持三种格式：
 * 1. TOML 格式（优先）：[thought] / [program] / [talk] 等 TOML 表
 * 2. 结构化段落格式：[thought] / [program] / [talk/目标] / [finish] / [wait] / [break]
 * 3. Markdown 代码块格式（兼容）：```javascript ... ```
 *
 * @ref docs/哲学文档/gene.md#G4 — implements — 从 LLM 输出中提取程序和指令
 */

import { parseOutput as parseTomlOutput } from "../toml/parser.js";
import type { ParsedOutput as TomlParsedOutput } from "../toml/parser.js";

/** 提取结果 */
export interface ExtractedProgram {
  /** 代码内容 */
  code: string;
  /** 在原文中的起始位置 */
  startIndex: number;
  /** 在原文中的结束位置 */
  endIndex: number;
  /** 执行语言: "javascript" | "shell"，默认 "javascript" */
  lang: "javascript" | "shell";
}

/** talk 段落提取结果 */
export interface ExtractedTalk {
  /** 目标对象名 */
  target: string;
  /** 消息内容 */
  message: string;
}

/** action 段落提取结果（结构化工具调用） */
export interface ExtractedAction {
  /** 工具方法名（从 [action/xxx] 提取） */
  toolName: string;
  /** JSON 参数字符串（段落内容） */
  params: string;
}

/** 栈帧 push 操作提取结果 */
export interface ExtractedStackFramePush {
  /** 操作类型：认知栈帧推入 或 反思栈帧推入 */
  type: "cognize_stack_frame_push" | "reflect_stack_frame_push";
  /** 栈帧标题 */
  title: string;
  /** 栈帧描述（可选） */
  description?: string;
  /** 特质列表（可选） */
  traits?: string[];
  /** 输出名称列表（可选） */
  outputs?: string[];
  /** 输出描述（可选） */
  outputDescription?: string;
}

/** 栈帧 pop 操作提取结果 */
export interface ExtractedStackFramePop {
  /** 操作类型：认知栈帧弹出 或 反思栈帧弹出 */
  type: "cognize_stack_frame_pop" | "reflect_stack_frame_pop";
  /** 执行摘要（可选） */
  summary?: string;
  /** 产出物（可选，JSON 格式） */
  artifacts?: Record<string, unknown>;
}

/** set_plan 操作提取结果 */
export interface ExtractedSetPlan {
  /** 操作类型：设置计划 */
  type: "set_plan";
  /** 计划内容 */
  content: string;
}

/** 结构化解析结果 */
export interface ParsedOutput {
  /** 思考内容（[thought] 段落） */
  thought: string;
  /** 可执行程序列表（[program] 段落） */
  programs: ExtractedProgram[];
  /** talk 消息列表（[talk/目标] 段落） */
  talks: ExtractedTalk[];
  /** action 工具调用列表（[action/工具名] 段落） */
  actions: ExtractedAction[];
  /** 栈帧操作列表 */
  stackFrameOperations: Array<
    ExtractedStackFramePush |
    ExtractedStackFramePop |
    ExtractedSetPlan
  >;
  /** 指令 */
  directives: { finish: boolean; wait: boolean; break_: boolean };
  /** 是否使用了结构化格式 */
  isStructured: boolean;
}

/**
 * 段落标记正则：匹配 [thought]、[program]、[finish]、[wait]、[break]
 * 标记必须独占一行（前后可有空白）
 */
const SECTION_TAG_RE = /^\s*\[(thought|program(?:\/(?:javascript|shell))?|finish|wait|break)\]\s*$/;

/**
 * talk 开始标记正则：匹配 [talk/目标对象名]
 * 目标名只允许字母、数字、下划线、连字符
 */
const TALK_OPEN_RE = /^\s*\[talk\/([a-zA-Z0-9_-]+)\]\s*$/;

/**
 * talk 结束标记正则：匹配 [/talk]
 */
const TALK_CLOSE_RE = /^\s*\[\/talk\]\s*$/;

/**
 * action 开始标记正则：匹配 [action/工具方法名]
 * 方法名只允许字母、数字、下划线、连字符
 */
const ACTION_OPEN_RE = /^\s*\[action\/([a-zA-Z0-9_-]+)\]\s*$/;

/**
 * action 结束标记正则：匹配 [/action]
 */
const ACTION_CLOSE_RE = /^\s*\[\/action\]\s*$/;

/**
 * 检测结构化格式的正则：[thought]、[program]、[talk/xxx]、[action/xxx] 才算结构化格式
 * [finish]/[wait]/[break] 在两种格式中都存在，不能作为判断依据
 */
const STRUCTURED_TAG_RE = /^\s*\[(thought|program(?:\/(?:javascript|shell))?)\]\s*$/;
const STRUCTURED_TALK_RE = /^\s*\[talk\/[a-zA-Z0-9_-]+\]\s*$/;
const STRUCTURED_ACTION_RE = /^\s*\[action\/[a-zA-Z0-9_-]+\]\s*$/;

/**
 * 认知栈操作标记正则
 */

/** 认知栈帧推入开始标记：[cognize_stack_frame_push] */
const COGNIZE_PUSH_RE = /^\s*\[cognize_stack_frame_push\]\s*$/;
/** 认知栈帧弹出开始标记：[cognize_stack_frame_pop] */
const COGNIZE_POP_RE = /^\s*\[cognize_stack_frame_pop\]\s*$/;
/** 反思栈帧推入开始标记：[reflect_stack_frame_push] */
const REFLECT_PUSH_RE = /^\s*\[reflect_stack_frame_push\]\s*$/;
/** 反思栈帧弹出开始标记：[reflect_stack_frame_pop] */
const REFLECT_POP_RE = /^\s*\[reflect_stack_frame_pop\]\s*$/;
/** 设置计划开始标记：[set_plan] */
const SET_PLAN_RE = /^\s*\[set_plan\]\s*$/;

/** 认知栈帧推入结束标记：[/cognize_stack_frame_push] */
const COGNIZE_PUSH_CLOSE_RE = /^\s*\[\/cognize_stack_frame_push\]\s*$/;
/** 认知栈帧弹出结束标记：[/cognize_stack_frame_pop] */
const COGNIZE_POP_CLOSE_RE = /^\s*\[\/cognize_stack_frame_pop\]\s*$/;
/** 反思栈帧推入结束标记：[/reflect_stack_frame_push] */
const REFLECT_PUSH_CLOSE_RE = /^\s*\[\/reflect_stack_frame_push\]\s*$/;
/** 反思栈帧弹出结束标记：[/reflect_stack_frame_pop] */
const REFLECT_POP_CLOSE_RE = /^\s*\[\/reflect_stack_frame_pop\]\s*$/;
/** 设置计划结束标记：[/set_plan] */
const SET_PLAN_CLOSE_RE = /^\s*\[\/set_plan\]\s*$/;

/** 认知栈帧推入属性段落标记：[cognize_stack_frame_push.title] 等 */
const COGNIZE_PUSH_ATTR_RE = /^\s*\[cognize_stack_frame_push\.(title|description|traits|outputs|outputDescription)\]\s*$/;
/** 认知栈帧弹出属性段落标记：[cognize_stack_frame_pop.summary] 等 */
const COGNIZE_POP_ATTR_RE = /^\s*\[cognize_stack_frame_pop\.(summary|artifacts)\]\s*$/;
/** 反思栈帧推入属性段落标记：[reflect_stack_frame_push.title] 等 */
const REFLECT_PUSH_ATTR_RE = /^\s*\[reflect_stack_frame_push\.(title|description|traits|outputs|outputDescription)\]\s*$/;
/** 反思栈帧弹出属性段落标记：[reflect_stack_frame_pop.summary] 等 */
const REFLECT_POP_ATTR_RE = /^\s*\[reflect_stack_frame_pop\.(summary|artifacts)\]\s*$/;

/** 认知栈帧推入属性段落结束标记：[/cognize_stack_frame_push.title] 等 */
const COGNIZE_PUSH_ATTR_CLOSE_RE = /^\s*\[\/cognize_stack_frame_push\.(title|description|traits|outputs|outputDescription)\]\s*$/;
/** 认知栈帧弹出属性段落结束标记：[/cognize_stack_frame_pop.summary] 等 */
const COGNIZE_POP_ATTR_CLOSE_RE = /^\s*\[\/cognize_stack_frame_pop\.(summary|artifacts)\]\s*$/;
/** 反思栈帧推入属性段落结束标记：[/reflect_stack_frame_push.title] 等 */
const REFLECT_PUSH_ATTR_CLOSE_RE = /^\s*\[\/reflect_stack_frame_push\.(title|description|traits|outputs|outputDescription)\]\s*$/;
/** 反思栈帧弹出属性段落结束标记：[/reflect_stack_frame_pop.summary] 等 */
const REFLECT_POP_ATTR_CLOSE_RE = /^\s*\[\/reflect_stack_frame_pop\.(summary|artifacts)\]\s*$/;

/**
 * 检测栈帧操作的结构化格式正则
 * 用于判断是否需要使用结构化解析路径
 */
const STRUCTURED_STACK_FRAME_RE = /^\s*\[(cognize_stack_frame_push|cognize_stack_frame_pop|reflect_stack_frame_push|reflect_stack_frame_pop|set_plan)\]\s*$/;

/**
 * 解析 LLM 输出（统一入口）
 *
 * 优先尝试 TOML 格式，然后是结构化段落格式，最后 fallback 到 markdown 代码块格式。
 */
export function parseLLMOutput(output: string): ParsedOutput {
  /* 预处理：清理 LLM 内部标记（<think>、</think> 等） */
  let cleaned = output.replace(/<\/?think>/g, "");

  /* 步骤 1：尝试 TOML 格式解析 */
  const tomlResult = tryParseTomlFormat(cleaned);
  if (tomlResult) {
    return tomlResult;
  }

  /* 步骤 2：旧的结构化段落格式解析 */
  /* 预处理：将内联的段落标记拆分到独立行
   * 例如 "code();\n[thought]" 或 "code();[thought]" → "code();\n[thought]\n"
   * 排除被反引号包裹的标记（如 `[program]`），避免 thought 中提及标记名时被误拆 */
  cleaned = cleaned.replace(/([^\n`])\[(thought|program(?:\/(?:javascript|shell))?|finish|wait|break)\](?!`)/g, "$1\n[$2]");
  cleaned = cleaned.replace(/(?<!`)\[(thought|program(?:\/(?:javascript|shell))?|finish|wait|break)\]([^\n`])/g, "[$1]\n$2");
  /* 同样处理 [talk/xxx] 和 [/talk] 的内联情况 */
  cleaned = cleaned.replace(/([^\n`])\[talk\//g, "$1\n[talk/");
  cleaned = cleaned.replace(/([^\n`])\[\/talk\]/g, "$1\n[/talk]");
  cleaned = cleaned.replace(/\[\/talk\]([^\n`])/g, "[/talk]\n$1");
  /* 同样处理 [action/xxx] 和 [/action] 的内联情况 */
  cleaned = cleaned.replace(/([^\n`])\[action\//g, "$1\n[action/");
  cleaned = cleaned.replace(/([^\n`])\[\/action\]/g, "$1\n[/action]");
  cleaned = cleaned.replace(/\[\/action\]([^\n`])/g, "[/action]\n$1");

  /* 同样处理栈帧操作标记的内联情况 */
  // 处理开始标记前：[cognize_xxx]、[reflect_xxx]（含属性版本 [xxx.title] 等）
  cleaned = cleaned.replace(/([^\n`])\[(cognize_|reflect_)/g, "$1\n[$2");
  // 处理开始标记前：[set_plan]
  cleaned = cleaned.replace(/([^\n`])\[set_plan\]/g, "$1\n[set_plan]");
  // 处理结束标记前：[/cognize_xxx]、[/reflect_xxx]
  cleaned = cleaned.replace(/([^\n`])\[\/(cognize_|reflect_)/g, "$1\n[/$2");
  // 处理结束标记前：[/set_plan]
  cleaned = cleaned.replace(/([^\n`])\[\/set_plan\]/g, "$1\n[/set_plan]");
  // 处理操作结束标记后面的字符（如 [/cognize_stack_frame_push]content）
  cleaned = cleaned.replace(/(\[\/(?:cognize_stack_frame_push|cognize_stack_frame_pop|reflect_stack_frame_push|reflect_stack_frame_pop|set_plan)\])([^\n`])/g, "$1\n$2");
  // 处理属性结束标记后面的字符（如 [/cognize_stack_frame_push.title]content）
  cleaned = cleaned.replace(/(\[\/(?:cognize_stack_frame_push|cognize_stack_frame_pop|reflect_stack_frame_push|reflect_stack_frame_pop)(?:\.\w+)?\])([^\n`])/g, "$1\n$2");
  // 处理开始/属性标记后面的字符（如 [cognize_stack_frame_push.title]content）
  cleaned = cleaned.replace(/(\[(?:cognize_stack_frame_push|cognize_stack_frame_pop|reflect_stack_frame_push|reflect_stack_frame_pop)(?:\.\w+)?\])([^\n`])/g, "$1\n$2");
  // 处理 [set_plan] 后面的字符
  cleaned = cleaned.replace(/(\[set_plan\])([^\n`])/g, "$1\n$2");

  /* 检测是否包含结构化段落标记（[thought]、[program]、[talk/xxx]、[action/xxx]、栈帧操作标记） */
  const lines = cleaned.split("\n");
  const hasStructuredTags = lines.some(line =>
    STRUCTURED_TAG_RE.test(line) ||
    STRUCTURED_TALK_RE.test(line) ||
    STRUCTURED_ACTION_RE.test(line) ||
    STRUCTURED_STACK_FRAME_RE.test(line)
  );

  if (hasStructuredTags) {
    return parseStructured(cleaned, lines);
  }

  /* Fallback: markdown 代码块格式 */
  return parseLegacy(cleaned);
}

/** 栈帧解析状态 */
type StackFrameParseState = {
  /** 当前正在解析的操作类型 */
  currentOp: "cognize_push" | "cognize_pop" | "reflect_push" | "reflect_pop" | "set_plan" | null;
  /** 当前正在解析的属性名 */
  currentAttr: string | null;
  /** 属性内容收集 */
  attrContent: string[];
  /** 已收集的属性 */
  collected: Record<string, string>;
};

/** 初始化栈帧解析状态 */
function initStackFrameState(): StackFrameParseState {
  return {
    currentOp: null,
    currentAttr: null,
    attrContent: [],
    collected: {},
  };
}

/** 刷新当前属性内容到 collected */
function flushAttr(state: StackFrameParseState): void {
  if (state.currentAttr && state.attrContent.length > 0) {
    const text = state.attrContent.join("\n").trim();
    if (text) {
      state.collected[state.currentAttr] = text;
    }
  }
  state.currentAttr = null;
  state.attrContent = [];
}

/** 从 collected 属性构建操作对象 */
function buildStackFrameOp(
  state: StackFrameParseState
): ExtractedStackFramePush | ExtractedStackFramePop | ExtractedSetPlan | null {
  const { currentOp, collected } = state;

  if (currentOp === "set_plan") {
    return {
      type: "set_plan",
      content: collected.content ?? "",
    };
  }

  if (currentOp === "cognize_push" || currentOp === "reflect_push") {
    // title 是必填项
    if (!collected.title) {
      return null; // 解析失败
    }
    const result: ExtractedStackFramePush = {
      type: currentOp === "cognize_push" ? "cognize_stack_frame_push" : "reflect_stack_frame_push",
      title: collected.title,
    };
    if (collected.description) result.description = collected.description;
    if (collected.traits) {
      result.traits = collected.traits.split(",").map((s) => s.trim()).filter((s) => s);
    }
    if (collected.outputs) {
      result.outputs = collected.outputs.split(",").map((s) => s.trim()).filter((s) => s);
    }
    if (collected.outputDescription) result.outputDescription = collected.outputDescription;
    return result;
  }

  if (currentOp === "cognize_pop" || currentOp === "reflect_pop") {
    const result: ExtractedStackFramePop = {
      type: currentOp === "cognize_pop" ? "cognize_stack_frame_pop" : "reflect_stack_frame_pop",
    };
    if (collected.summary) result.summary = collected.summary;
    if (collected.artifacts) {
      try {
        result.artifacts = JSON.parse(collected.artifacts);
      } catch {
        // JSON 解析失败，只忽略 artifacts，保留其他字段
      }
    }
    return result;
  }

  return null;
}

/**
 * 结构化段落解析
 *
 * 格式：
 * [thought]
 * 思考内容...
 *
 * [program]
 * const x = getData("key");
 * print(x);
 *
 * [finish]
 */
function parseStructured(output: string, lines: string[]): ParsedOutput {
  const thoughtParts: string[] = [];
  const programs: ExtractedProgram[] = [];
  const talks: ExtractedTalk[] = [];
  const actions: ExtractedAction[] = [];
  let finish = false;
  let wait = false;
  let break_ = false;

  let currentSection: "thought" | "program" | "talk" | "action" | null = null;
  let currentTalkTarget: string | null = null;
  let currentActionToolName: string | null = null;
  let currentLang: "javascript" | "shell" = "javascript";
  let currentContent: string[] = [];
  let sectionStartLine = 0;
  let seenTag = false;

  // 栈帧操作解析状态
  const stackFrameState = initStackFrameState();
  const stackFrameOperations: Array<
    ExtractedStackFramePush |
    ExtractedStackFramePop |
    ExtractedSetPlan
  > = [];

  const flushSection = (lineIndex: number) => {
    // 先处理栈帧属性
    if (stackFrameState.currentOp !== null) {
      flushAttr(stackFrameState);
    }

    if (currentSection === "thought") {
      const text = currentContent.join("\n").trim();
      if (text) thoughtParts.push(text);
    } else if (currentSection === "program") {
      let code = currentContent.join("\n").trim();
      /* 清理 LLM 额外输出的 markdown 代码块标记（```） */
      if (code) {
        /* 移除开头的 ``` 或 ```javascript 或 ```js 或 ```typescript 或 ```ts 或 ```shell 或 ```sh */
        code = code.replace(/^```(javascript|js|typescript|ts|shell|sh|tsx|jsx)?\s*/, "");
        /* 移除结尾的 ``` */
        code = code.replace(/\s*```$/, "");
        code = code.trim();
      }
      if (code) {
        /* 计算在原文中的大致位置 */
        const startIndex = lines.slice(0, sectionStartLine).join("\n").length + 1;
        const endIndex = lines.slice(0, lineIndex).join("\n").length;
        programs.push({ code, startIndex, endIndex, lang: currentLang });
      }
    } else if (currentSection === "talk" && currentTalkTarget) {
      const message = currentContent.join("\n").trim();
      if (message) {
        talks.push({ target: currentTalkTarget, message });
      }
    } else if (currentSection === "action" && currentActionToolName) {
      const params = currentContent.join("\n").trim();
      if (params) {
        actions.push({ toolName: currentActionToolName, params });
      }
    }
    currentSection = null;
    currentTalkTarget = null;
    currentActionToolName = null;
    currentContent = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = SECTION_TAG_RE.exec(line);
    const talkOpenMatch = TALK_OPEN_RE.exec(line);
    const talkCloseMatch = TALK_CLOSE_RE.test(line);
    const actionOpenMatch = ACTION_OPEN_RE.exec(line);
    const actionCloseMatch = ACTION_CLOSE_RE.test(line);

    // 检测栈帧操作开始标记
    const isCognizePush = COGNIZE_PUSH_RE.test(line);
    const isCognizePop = COGNIZE_POP_RE.test(line);
    const isReflectPush = REFLECT_PUSH_RE.test(line);
    const isReflectPop = REFLECT_POP_RE.test(line);
    const isSetPlan = SET_PLAN_RE.test(line);

    // 检测栈帧操作结束标记
    const isCognizePushClose = COGNIZE_PUSH_CLOSE_RE.test(line);
    const isCognizePopClose = COGNIZE_POP_CLOSE_RE.test(line);
    const isReflectPushClose = REFLECT_PUSH_CLOSE_RE.test(line);
    const isReflectPopClose = REFLECT_POP_CLOSE_RE.test(line);
    const isSetPlanClose = SET_PLAN_CLOSE_RE.test(line);

    // 检测栈帧属性标记
    const cognizePushAttrMatch = COGNIZE_PUSH_ATTR_RE.exec(line);
    const cognizePopAttrMatch = COGNIZE_POP_ATTR_RE.exec(line);
    const reflectPushAttrMatch = REFLECT_PUSH_ATTR_RE.exec(line);
    const reflectPopAttrMatch = REFLECT_POP_ATTR_RE.exec(line);

    // 检测栈帧属性结束标记
    const isCognizePushAttrClose = COGNIZE_PUSH_ATTR_CLOSE_RE.test(line);
    const isCognizePopAttrClose = COGNIZE_POP_ATTR_CLOSE_RE.test(line);
    const isReflectPushAttrClose = REFLECT_PUSH_ATTR_CLOSE_RE.test(line);
    const isReflectPopAttrClose = REFLECT_POP_ATTR_CLOSE_RE.test(line);
    const isStackFrameAttrClose = isCognizePushAttrClose || isCognizePopAttrClose || isReflectPushAttrClose || isReflectPopAttrClose;

    if (talkCloseMatch && currentSection === "talk") {
      /* [/talk] 结束当前 talk 段落 */
      flushSection(i);
    } else if (actionCloseMatch && currentSection === "action") {
      /* [/action] 结束当前 action 段落 */
      flushSection(i);
    } else if (
      // 处理栈帧操作结束标记
      (isCognizePushClose && stackFrameState.currentOp === "cognize_push") ||
      (isCognizePopClose && stackFrameState.currentOp === "cognize_pop") ||
      (isReflectPushClose && stackFrameState.currentOp === "reflect_push") ||
      (isReflectPopClose && stackFrameState.currentOp === "reflect_pop") ||
      (isSetPlanClose && stackFrameState.currentOp === "set_plan")
    ) {
      flushAttr(stackFrameState);
      const op = buildStackFrameOp(stackFrameState);
      if (op) {
        stackFrameOperations.push(op);
      }
      // 重置状态
      stackFrameState.currentOp = null;
      stackFrameState.collected = {};
      seenTag = true;
      continue;
    } else if (isStackFrameAttrClose && stackFrameState.currentOp !== null) {
      // 处理栈帧属性结束标记（如 [/cognize_stack_frame_push.title]）
      flushAttr(stackFrameState);
      seenTag = true;
      continue;
    } else if (talkOpenMatch) {
      /* [talk/target] 开始新的 talk 段落 */
      flushSection(i);
      seenTag = true;
      currentSection = "talk";
      currentTalkTarget = talkOpenMatch[1]!;
      sectionStartLine = i + 1;
    } else if (actionOpenMatch) {
      /* [action/toolName] 开始新的 action 段落 */
      flushSection(i);
      seenTag = true;
      currentSection = "action";
      currentActionToolName = actionOpenMatch[1]!;
      sectionStartLine = i + 1;
    } else if (isSetPlan) {
      // 处理 set_plan 开始标记（内容直接收集，不需要属性段落）
      // 嵌套检测：如果已有正在进行的栈帧操作，忽略内层操作（避免破坏外层状态）
      if (stackFrameState.currentOp !== null) {
        continue;
      }
      flushSection(i);
      seenTag = true;
      stackFrameState.currentOp = "set_plan";
      stackFrameState.currentAttr = "content";
      stackFrameState.attrContent = [];
      continue;
    } else if (isCognizePush || isCognizePop || isReflectPush || isReflectPop) {
      // 处理栈帧操作开始标记
      // 嵌套检测：如果已有正在进行的栈帧操作，忽略内层操作（避免破坏外层状态）
      if (stackFrameState.currentOp !== null) {
        continue;
      }
      flushSection(i);
      seenTag = true;
      if (isCognizePush) stackFrameState.currentOp = "cognize_push";
      else if (isCognizePop) stackFrameState.currentOp = "cognize_pop";
      else if (isReflectPush) stackFrameState.currentOp = "reflect_push";
      else if (isReflectPop) stackFrameState.currentOp = "reflect_pop";
      stackFrameState.collected = {};
      continue;
    } else if (cognizePushAttrMatch || cognizePopAttrMatch || reflectPushAttrMatch || reflectPopAttrMatch) {
      // 处理栈帧属性段落开始标记
      flushAttr(stackFrameState);
      seenTag = true;
      let attrName: string | null = null;
      if (cognizePushAttrMatch) attrName = cognizePushAttrMatch[1]!;
      else if (cognizePopAttrMatch) attrName = cognizePopAttrMatch[1]!;
      else if (reflectPushAttrMatch) attrName = reflectPushAttrMatch[1]!;
      else if (reflectPopAttrMatch) attrName = reflectPopAttrMatch[1]!;
      if (attrName) {
        stackFrameState.currentAttr = attrName;
        stackFrameState.attrContent = [];
      }
      continue;
    } else if (match) {
      flushSection(i);
      seenTag = true;
      const tag = match[1] as string;
      if (tag === "thought") {
        currentSection = "thought";
        sectionStartLine = i + 1;
      } else if (tag === "program" || tag.startsWith("program/")) {
        currentSection = "program";
        /* 从标记提取语言: "program" → "javascript", "program/shell" → "shell", "program/javascript" → "javascript" */
        currentLang = tag === "program" || tag === "program/javascript" ? "javascript" : "shell";
        sectionStartLine = i + 1;
      } else if (tag === "finish") {
        finish = true;
      } else if (tag === "wait") {
        wait = true;
      } else if (tag === "break") {
        break_ = true;
      }
    } else if (stackFrameState.currentOp !== null && stackFrameState.currentAttr !== null) {
      // 如果正在解析栈帧操作，收集内容到当前属性
      stackFrameState.attrContent.push(line);
      continue;
    } else if (currentSection) {
      currentContent.push(line);
    } else if (!seenTag) {
      /* 第一个标记之前的文本视为 thought */
      const trimmed = line.trim();
      if (trimmed) thoughtParts.push(trimmed);
    }
  }

  /* flush 最后一个 section */
  flushSection(lines.length);

  /* 过滤空 program 块（只有空白的 program 不算有效 program） */
  const nonEmptyPrograms = programs.filter(p => p.code.trim().length > 0);

  /* 互斥校验：[talk] 和 [program] 不能并存；[action] 和 [program] 不能并存。
   * 如果同时出现，忽略 talk/action 段落（program 优先，保持向后兼容）。
   * [action] 和 [talk] 可以共存。
   * 注意：空 program 块不参与互斥判断。 */
  const finalTalks = nonEmptyPrograms.length > 0 ? [] : talks;
  const finalActions = nonEmptyPrograms.length > 0 ? [] : actions;

  return {
    thought: thoughtParts.join("\n"),
    programs: nonEmptyPrograms,
    talks: finalTalks,
    actions: finalActions,
    stackFrameOperations,
    directives: { finish, wait, break_ },
    isStructured: true,
  };
}

/**
 * Legacy 解析（markdown 代码块格式）
 *
 * 兼容旧格式：```javascript ... ```
 */
function parseLegacy(output: string): ParsedOutput {
  const programs = extractPrograms(output);
  const directives = detectDirectives(output);

  /* 提取 thought：移除代码块和指令后的文本 */
  let thought = output.replace(/```[\s\S]*?```/g, "");
  thought = thought.replace(/\[finish\]/g, "").replace(/\[wait\]/g, "").replace(/\[break\]/g, "");
  thought = thought.replace(/\[SYSTEM\]/g, "").replace(/<\/think>/g, "").replace(/<think>/g, "");
  thought = thought.trim();

  return {
    thought,
    programs,
    talks: [],
    actions: [],
    stackFrameOperations: [],
    directives,
    isStructured: false,
  };
}

/**
 * 从 LLM 输出中提取所有 JavaScript 代码块（legacy）
 *
 * 支持的格式：
 * ```javascript
 * // code here
 * ```
 * 也支持 ```js 标记。
 */
export function extractPrograms(output: string): ExtractedProgram[] {
  const programs: ExtractedProgram[] = [];
  const regex = /```(?:javascript|js)\s*\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const code = match[1]!.trim();
    if (code.length > 0) {
      programs.push({
        code,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        lang: "javascript",
      });
    }
  }

  return programs;
}

/**
 * 检查 LLM 输出中是否包含特殊指令（legacy）
 */
export function detectDirectives(output: string): {
  finish: boolean;
  break_: boolean;
  wait: boolean;
} {
  return {
    finish: output.includes("[finish]"),
    break_: output.includes("[break]"),
    wait: output.includes("[wait]"),
  };
}

/**
 * 从 LLM 输出中提取纯文本回复（legacy）
 *
 * 优先级：
 * 1. 移除 [finish]/[wait]/[break] 指令和代码块后的文本
 * 2. 如果剩余文本为空，使用 print() 输出作为回复
 * 3. 如果都没有，返回空字符串
 */
export function extractReplyContent(llmOutput: string, printOutputs?: string[]): string {
  /* 移除代码块 */
  let text = llmOutput.replace(/```[\s\S]*?```/g, "");
  /* 移除指令标记 */
  text = text.replace(/\[finish\]/g, "").replace(/\[wait\]/g, "").replace(/\[break\]/g, "");
  /* 移除 [SYSTEM] 和 </think> 等系统标签 */
  text = text.replace(/\[SYSTEM\]/g, "").replace(/<\/think>/g, "").replace(/<think>/g, "");
  text = text.trim();

  if (text) return text;

  /* 回退到 print() 输出 */
  if (printOutputs && printOutputs.length > 0) {
    return printOutputs.join("\n").trim();
  }

  return "";
}

// ─── TOML 格式支持 ─────────────────────────────────────────────

/**
 * 检测是否可能是 TOML 格式
 * 检查是否有 TOML 特有的模式：[section] 后接 key = value
 */
function looksLikeTomlFormat(output: string): boolean {
  // 检查是否有 [thought] 或 [program] 或 [talk] 后接 content = 或 code = 等模式
  const lines = output.split("\n");
  let inTomlSection = false;
  let tomlKeyCount = 0;

  for (const line of lines) {
    // 检测 TOML 段标题：[thought]、[program]、[talk]、[cognize_stack_frame_push] 等
    const sectionMatch = line.match(/^\s*\[([a-zA-Z_][a-zA-Z0-9_]*)\]\s*$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      // 这些段名在旧格式和 TOML 格式中都存在
      // 需要进一步检测是否有 key = value 模式
      if (["thought", "program", "talk", "action", "finish", "wait", "break",
           "cognize_stack_frame_push", "cognize_stack_frame_pop",
           "reflect_stack_frame_push", "reflect_stack_frame_pop",
           "set_plan", "directives"].includes(sectionName)) {
        inTomlSection = true;
        continue;
      }
    }

    if (inTomlSection) {
      // 检测 TOML 键值对模式：key = "value" 或 key = '''multiline''' 或 key = [...]
      // 排除旧格式的标记行
      if (line.match(/^\s*\[\/?[a-zA-Z_]/)) {
        // 这是旧格式的段标记，不是 TOML
        inTomlSection = false;
        continue;
      }

      // 检测 key = value 模式
      if (line.match(/^\s*[a-zA-Z_][a-zA-Z0-9_]*\s*=\s*.+$/)) {
        tomlKeyCount++;
      }
    }
  }

  // 如果有 2 个或更多 TOML 键值对，认为是 TOML 格式
  return tomlKeyCount >= 2;
}

/**
 * 尝试用 TOML 格式解析
 * 如果成功且有有效内容，返回 ParsedOutput；否则返回 null
 */
function tryParseTomlFormat(output: string): ParsedOutput | null {
  // 先快速检测是否可能是 TOML 格式
  if (!looksLikeTomlFormat(output)) {
    return null;
  }

  try {
    const tomlParsed = parseTomlOutput(output) as TomlParsedOutput;

    // 检查是否有有效内容
    const hasContent =
      tomlParsed.thought !== undefined ||
      tomlParsed.program !== undefined ||
      tomlParsed.talk !== undefined ||
      (tomlParsed.actions && tomlParsed.actions.length > 0) ||
      tomlParsed.cognize_stack_frame_push !== undefined ||
      tomlParsed.cognize_stack_frame_pop !== undefined ||
      tomlParsed.reflect_stack_frame_push !== undefined ||
      tomlParsed.reflect_stack_frame_pop !== undefined ||
      tomlParsed.set_plan !== undefined ||
      (tomlParsed.directives && Object.keys(tomlParsed.directives).length > 0);

    if (!hasContent) {
      return null;
    }

    // 转换为 flow/parser 的 ParsedOutput 格式
    return convertTomlToFlowFormat(tomlParsed);
  } catch {
    // TOML 解析失败，回退到旧格式
    return null;
  }
}

/**
 * 将 TOML 解析结果转换为 flow/parser 的 ParsedOutput 格式
 */
function convertTomlToFlowFormat(toml: TomlParsedOutput): ParsedOutput {
  const stackFrameOperations: Array<
    ExtractedStackFramePush | ExtractedStackFramePop | ExtractedSetPlan
  > = [];

  // 转换 cognize_stack_frame_push
  if (toml.cognize_stack_frame_push) {
    const push = toml.cognize_stack_frame_push;
    stackFrameOperations.push({
      type: "cognize_stack_frame_push",
      title: push.title ?? "",
      description: push.description,
      traits: push.traits,
      outputs: push.outputs,
      outputDescription: push.output_description, // 注意字段名不同：output_description vs outputDescription
    });
  }

  // 转换 cognize_stack_frame_pop
  if (toml.cognize_stack_frame_pop) {
    const pop = toml.cognize_stack_frame_pop;
    stackFrameOperations.push({
      type: "cognize_stack_frame_pop",
      summary: pop.summary,
      artifacts: pop.artifacts,
    });
  }

  // 转换 reflect_stack_frame_push
  if (toml.reflect_stack_frame_push) {
    const push = toml.reflect_stack_frame_push;
    stackFrameOperations.push({
      type: "reflect_stack_frame_push",
      title: push.title ?? "",
      description: push.description,
    });
  }

  // 转换 reflect_stack_frame_pop
  if (toml.reflect_stack_frame_pop) {
    const pop = toml.reflect_stack_frame_pop;
    stackFrameOperations.push({
      type: "reflect_stack_frame_pop",
      summary: pop.summary,
    });
  }

  // 转换 set_plan
  if (toml.set_plan) {
    stackFrameOperations.push({
      type: "set_plan",
      content: toml.set_plan,
    });
  }

  // 转换 programs
  const programs: ExtractedProgram[] = [];
  if (toml.program) {
    const prog = toml.program;
    // 规范化语言类型：typescript 映射到 javascript
    let lang: "javascript" | "shell" = "javascript";
    if (prog.lang === "shell") {
      lang = "shell";
    }
    programs.push({
      code: prog.code,
      startIndex: 0, // TOML 解析不追踪位置
      endIndex: 0,
      lang,
    });
  }

  // 转换 talks
  const talks: ExtractedTalk[] = [];
  if (toml.talk) {
    talks.push({
      target: toml.talk.target,
      message: toml.talk.message,
    });
  }

  // 转换 actions
  const actions: ExtractedAction[] = [];
  if (toml.actions && toml.actions.length > 0) {
    for (const act of toml.actions) {
      actions.push({
        toolName: act.tool,
        params: JSON.stringify(act.params), // 转换为 JSON 字符串
      });
    }
  }

  // 转换 directives
  const directives = {
    finish: toml.directives?.finish === true,
    wait: toml.directives?.wait === true,
    break_: toml.directives?.break === true,
  };

  // 互斥校验：program 和 talk/action 不能并存
  const hasProgram = programs.length > 0 && programs[0]!.code.trim().length > 0;
  const finalTalks = hasProgram ? [] : talks;
  const finalActions = hasProgram ? [] : actions;

  return {
    thought: toml.thought ?? "",
    programs: hasProgram ? programs : [],
    talks: finalTalks,
    actions: finalActions,
    stackFrameOperations,
    directives,
    isStructured: true,
  };
}
