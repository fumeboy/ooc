/**
 * 程序提取器
 *
 * 从 LLM 输出中提取思考内容和可执行程序。
 *
 * 支持两种格式：
 * 1. 结构化段落格式（优先）：[thought] / [program] / [talk/目标] / [finish] / [wait] / [break]
 * 2. Markdown 代码块格式（兼容）：```javascript ... ```
 *
 * @ref docs/哲学文档/gene.md#G4 — implements — 从 LLM 输出中提取程序和指令
 */

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
 * 解析 LLM 输出（统一入口）
 *
 * 优先尝试结构化段落格式，如果没有检测到 [thought] 或 [program] 标记则 fallback 到 markdown 代码块格式。
 */
export function parseLLMOutput(output: string): ParsedOutput {
  /* 预处理：清理 LLM 内部标记（<think>、</think> 等） */
  let cleaned = output.replace(/<\/?think>/g, "");

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

  /* 检测是否包含结构化段落标记（[thought]、[program]、[talk/xxx]、[action/xxx]） */
  const lines = cleaned.split("\n");
  const hasStructuredTags = lines.some(line => STRUCTURED_TAG_RE.test(line) || STRUCTURED_TALK_RE.test(line) || STRUCTURED_ACTION_RE.test(line));

  if (hasStructuredTags) {
    return parseStructured(cleaned, lines);
  }

  /* Fallback: markdown 代码块格式 */
  return parseLegacy(cleaned);
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

  const flushSection = (lineIndex: number) => {
    if (currentSection === "thought") {
      const text = currentContent.join("\n").trim();
      if (text) thoughtParts.push(text);
    } else if (currentSection === "program") {
      const code = currentContent.join("\n").trim();
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

    if (talkCloseMatch && currentSection === "talk") {
      /* [/talk] 结束当前 talk 段落 */
      flushSection(i);
    } else if (actionCloseMatch && currentSection === "action") {
      /* [/action] 结束当前 action 段落 */
      flushSection(i);
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
