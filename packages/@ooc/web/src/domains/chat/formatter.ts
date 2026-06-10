import type { ChatLine, ThreadContext, ThreadMessage, ToolFollowUp, ToolMark, ToolSummaryField } from "./model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function stringifyData(value: unknown) {
  if (value == null) return undefined;
  const parsed = parseStructuredValue(value);
  if (typeof parsed === "string") return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
  }
}

function asDisplayText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyData(value);
}

function extractMarks(argumentsValue: unknown): ToolMark[] | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  const raw = Array.isArray(argumentsValue.mark)
    ? argumentsValue.mark
    : Array.isArray(argumentsValue.marks)
      ? argumentsValue.marks
      : undefined;
  if (!raw?.length) return undefined;
  return raw
    .filter(isRecord)
    .map((entry) => ({
      messageId: typeof entry.messageId === "string" ? entry.messageId : undefined,
      type: typeof entry.class === "string" ? entry.class : undefined,
      tip: typeof entry.tip === "string" ? entry.tip : undefined,
    }));
}

function buildRefineSummaryFields(argumentsValue: Record<string, unknown>): ToolSummaryField[] {
  const fields: ToolSummaryField[] = [];
  const formId = asDisplayText(argumentsValue.form_id);
  if (formId) fields.push({ label: "form", value: formId });
  const formArgs = isRecord(argumentsValue.form_args)
    ? argumentsValue.form_args
    : isRecord(argumentsValue.args)
      ? argumentsValue.args
      : undefined;
  if (!formArgs) return fields;
  for (const [key, value] of Object.entries(formArgs)) {
    const text = asDisplayText(value);
    if (text) fields.push({ label: key, value: text });
  }
  return fields;
}

function buildToolSummaryFields(toolName: string, argumentsValue: unknown): ToolSummaryField[] | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  const fields: ToolSummaryField[] = [];
  if (toolName === "open") {
    // ContextWindow 协议（spec 2026-05-14）：parent_window_id + method + args
    const parent = asDisplayText(argumentsValue.parent_window_id);
    if (parent) fields.push({ label: "parent", value: parent });
    const command = asDisplayText(argumentsValue.method ?? argumentsValue.method);
    if (command) fields.push({ label: "method", value: command });
    if (isRecord(argumentsValue.args)) {
      for (const [k, v] of Object.entries(argumentsValue.args)) {
        const text = asDisplayText(v);
        if (text) fields.push({ label: k, value: text });
      }
    }
  }
  if (toolName === "refine") {
    fields.push(...buildRefineSummaryFields(argumentsValue));
  }
  if (toolName === "submit") {
    const formId = asDisplayText(argumentsValue.form_id);
    if (formId) fields.push({ label: "form", value: formId });
  }
  if (toolName === "close") {
    // close 在新模型下用 window_id；保留 form_id 兼容旧调用习惯
    const windowId = asDisplayText(argumentsValue.window_id) ?? asDisplayText(argumentsValue.form_id);
    if (windowId) fields.push({ label: "window", value: windowId });
  }
  if (toolName === "wait") {
    return undefined;
  }
  return fields.length ? fields : undefined;
}

function buildToolHeaderDescription(toolName: string, argumentsValue: unknown): string | undefined {
  if (!isRecord(argumentsValue)) return undefined;
  if (toolName === "open") {
    return asDisplayText(argumentsValue.description);
  }
  if (toolName === "wait" || toolName === "close") {
    return asDisplayText(argumentsValue.reason);
  }
  return undefined;
}

function buildToolLine(input: {
  id: string;
  toolName: string;
  callId?: string;
  argumentsValue?: unknown;
  outputValue?: unknown;
  ok?: boolean;
  pending?: boolean;
}): ChatLine {
  const title = isRecord(input.argumentsValue) && typeof input.argumentsValue.title === "string"
    ? input.argumentsValue.title
    : undefined;
  return {
    id: input.id,
    kind: "tool",
    role: "tool",
    toolName: input.toolName,
    callId: input.callId,
    title,
    headerDescription: buildToolHeaderDescription(input.toolName, input.argumentsValue),
    summaryFields: buildToolSummaryFields(input.toolName, input.argumentsValue),
    marks: extractMarks(input.argumentsValue),
    rawArguments: input.argumentsValue,
    rawOutput: input.outputValue,
    argumentsText: stringifyData(input.argumentsValue),
    outputText: stringifyData(input.outputValue),
    // 优先以 output JSON 里的 ok 为准(覆盖旧 thread.json 里 event.ok 硬 true 的 bug);
    // 仅当 output 不能解析或没有 ok 字段时,回退用 event.ok。
    ok: deriveOk(input.outputValue, input.ok),
    pending: input.pending,
  };
}

/**
 * 抽出 tool 调用所"作用于"的 window/form id：
 * - `open`: 创建了新 form_window，id 在 OUTPUT JSON 里（`form_id` 主、`window_id` fallback）
 * - `refine`/`submit`: id = arguments.form_id（fallback parent_window_id / window_id）
 * - `close`: id = arguments.form_id（fallback window_id）
 *
 * 注：实际后端约定字段是 `form_id`；老路径或不同
 * 命令族可能用 `window_id`/`parent_window_id`，全部一并接受以兼容。
 *
 * 取不到时返回 undefined（caller 自行决定不分组）。
 */
function deriveTargetWindowId(
  toolName: string,
  argumentsValue: unknown,
  outputValue: unknown,
): string | undefined {
  if (toolName === "open") {
    const parsed = parseStructuredValue(outputValue);
    if (isRecord(parsed)) {
      const id =
        asDisplayText(parsed.form_id) ??
        asDisplayText(parsed.window_id) ??
        asDisplayText(parsed.windowId);
      if (id) return id;
    }
    return undefined;
  }
  if (!isRecord(argumentsValue)) return undefined;
  if (toolName === "refine" || toolName === "submit") {
    return (
      asDisplayText(argumentsValue.form_id) ??
      asDisplayText(argumentsValue.parent_window_id) ??
      asDisplayText(argumentsValue.window_id)
    );
  }
  if (toolName === "close") {
    return asDisplayText(argumentsValue.form_id) ?? asDisplayText(argumentsValue.window_id);
  }
  return undefined;
}

const MERGEABLE_FOLLOWUP_TOOLS = new Set(["refine", "submit", "close"]);

/**
 * 把连续的 `open → refine/submit/close（同 window_id）` 折叠成主 tool 卡的
 * `followUps` 列表。仅作用于"完全相邻"的 tool line 链 —— 中间夹任何 message / notice
 * / 不同 window 的 tool 时立即断链，避免把语义上无关的两组 form 操作粘在一起。
 *
 * 不修改输入 lines 的引用语义；输出新数组。
 */
function groupConsecutiveToolLines(lines: ChatLine[]): ChatLine[] {
  const result: ChatLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i]!;
    if (head.kind !== "tool" || head.toolName !== "open") {
      result.push(head);
      continue;
    }
    const headWindowId = deriveTargetWindowId(head.toolName, head.rawArguments, head.rawOutput);
    if (!headWindowId) {
      result.push(head);
      continue;
    }
    const followUps: ToolFollowUp[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j]!;
      if (next.kind !== "tool") break;
      if (!MERGEABLE_FOLLOWUP_TOOLS.has(next.toolName)) break;
      const nextWindowId = deriveTargetWindowId(next.toolName, next.rawArguments, next.rawOutput);
      if (nextWindowId !== headWindowId) break;
      followUps.push({
        id: next.id,
        toolName: next.toolName,
        callId: next.callId,
        title: next.title,
        headerDescription: next.headerDescription,
        summaryFields: next.summaryFields,
        argumentsText: next.argumentsText,
        outputText: next.outputText,
        rawArguments: next.rawArguments,
        rawOutput: next.rawOutput,
        ok: next.ok,
        pending: next.pending,
      });
      j += 1;
    }
    if (followUps.length > 0) {
      result.push({ ...head, followUps });
      i = j - 1; // 让外层循环 i+=1 跳到 j
    } else {
      result.push(head);
    }
  }
  return result;
}

/**
 * 优先看 output JSON 中的 ok(reliable source — 由 tool handler 显式写入);
 * 若 output 不是合规 JSON 或无 ok 字段,退而用 event.ok(旧数据可能不准但聊胜于无)。
 */
function deriveOk(outputValue: unknown, eventOk: boolean | undefined): boolean | undefined {
  const parsed = parseJsonString(outputValue);
  if (parsed && typeof parsed === "object" && "ok" in parsed) {
    const v = (parsed as Record<string, unknown>).ok;
    if (typeof v === "boolean") return v;
  }
  return eventOk;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function findInboxMessage(thread: ThreadContext, msgId?: string) {
  if (!msgId) return undefined;
  return thread.inbox?.find((message) => message.id === msgId);
}

/**
 * 识别 "exec(method=say) on talk_window" 这类对外消息工具调用,把里面的 msg 提升为
 * 一条 message line。让查看 assistant.t_user_xxx 这种 thread 时,assistant 发回 user
 * 的消息能像普通对话一样出现在 timeline,而不是只藏在 tool card 的 args JSON 里。
 *
 * 触发条件(全部满足才生成 message line,否则返回 undefined):
 * - toolName === "open"
 * - arguments.method === "say"
 * - arguments.parent_window_id 对应一个 talk_window(存在 talkWindowTargets 中)
 * - arguments.args.msg 是非空字符串
 *
 * 返回 role="assistant" 的 message,senderLabel 标"→ <target>",让用户秒懂去向。
 */
function maybeBuildOutboundSayLine(
  event: Record<string, unknown>,
  baseId: string,
  talkWindowTargets: Map<string, string>,
): ChatLine | undefined {
  if (event.toolName !== "open") return undefined;
  const args = isRecord(event.arguments) ? event.arguments : undefined;
  if (!args || args.method !== "say" && args.method !== "say") return undefined;
  const parentWindowId = typeof args.parent_window_id === "string" ? args.parent_window_id : undefined;
  if (!parentWindowId) return undefined;
  const target = talkWindowTargets.get(parentWindowId);
  if (!target) return undefined;
  const inner = isRecord(args.args) ? args.args : undefined;
  const msg = inner && typeof inner.msg === "string" ? inner.msg : undefined;
  if (!msg) return undefined;
  return {
    id: `${baseId}-say`,
    kind: "message",
    role: "assistant",
    content: msg,
    senderLabel: `→ ${target}`,
  };
}

/**
 * 从 thread.outbox 直接生成"发给指定对端的消息" chat lines。
 *
 * 为什么需要这一招:LLM 常用 exec(method=say) → refine(args.msg) → submit 三段式,
 * 消息正文最终在 refine.args.msg → 通过 submit 提交后落到 thread.outbox。
 * 直接从 outbox 取已发送消息更简单可靠:outbox 自带 windowId,与 talk_window 一查
 * 就能判断"是不是发给目标对端的"。
 *
 * 返回 ChatLine + createdAt(用作排序键),让调用方按 createdAt 与 inbox 行合并。
 */
function buildOutboundMessageLinesForTargets(
  outbox: ThreadMessage[],
  talkWindowTargets: Map<string, string>,
  targetFilter: (target: string) => boolean,
): Array<{ createdAt: number; line: ChatLine }> {
  const items: Array<{ createdAt: number; line: ChatLine }> = [];
  for (const m of outbox) {
    // target 优先从 talk window 映射里取（windowId → target），fallback 到消息自己带的
    // targetObjectId（手动构造 / 非 talk 路径的消息可能没有 windowId）。
    const target =
      (m.windowId ? talkWindowTargets.get(m.windowId) : undefined) ??
      (m as any).targetObjectId ??
      undefined;
    if (!target) continue;
    if (!targetFilter(target)) continue;
    // 兼容 canonical `content` 字段和 legacy `text` 字段
    const body = (m as any).content ?? (m as any).text;
    if (!body) continue;
    items.push({
      createdAt: m.createdAt ?? 0,
      line: {
        id: m.id ? `outbox-${m.id}` : `outbox-${target}-${m.createdAt ?? items.length}`,
        kind: "message",
        role: "assistant",
        content: body,
        senderLabel: `→ ${target}`,
      },
    });
  }
  return items;
}

/**
 * 构造 inbox 消息的发送方标签。
 * 优先级:
 * - fromObjectId 存在 → "<obj>:<short threadId>"(主要场景:跨对象 talk)
 * - source="user"  → "user"
 * - source="system" → "system"
 * - source="talk"  → "talk · <fromThreadId>" (fallback;旧数据无 fromObjectId)
 * - 其它/缺省      → fromThreadId 或 "?"
 */
function senderLabelOf(message: {
  source?: string;
  fromThreadId?: string;
  fromObjectId?: string;
}): string {
  const src = message.source;
  const from = message.fromThreadId;
  const obj = message.fromObjectId;
  if (obj) {
    return from ? `${obj} · ${from}` : obj;
  }
  if (src === "user") return "user";
  if (src === "system") return "system";
  if (src === "talk") return from ? `talk · ${from}` : "talk";
  if (from) return from;
  return "?";
}

function isErrorText(text: string) {
  return text.startsWith("[错误]") || text.includes("失败") || text.includes("Error") || text.includes("error");
}

function fallbackNotice(index: number, record: Record<string, unknown>): ChatLine {
  return {
    id: `event-${index}`,
    kind: "notice",
    role: "notice",
    title: `${String(record.category ?? "event")} · ${String(record.kind ?? "unknown")}`,
    content: stringifyData(record) ?? "(empty event)",
    tone: "info",
  };
}

export function formatThread(thread?: ThreadContext): ChatLine[] {
  if (!thread) return [];
  const lines: ChatLine[] = [];
  const events = thread.events ?? [];

  // 预先索引:talk window id → target,用于把 "exec(method=say, window_id=...)"
  // 这种隐藏在 tool args 里的"对外消息"识别出来并提升为可读的 message line。
  // 典型场景:assistant.t_user_xxx 给 user 发的回信 — 我们希望在时间线上看到"→ user: 内容",
  // 而不是只看到 JSON 化的 open 工具卡。
  const talkWindowTargets = new Map<string, string>();
  for (const w of thread.contextWindows ?? []) {
    if (w.class === "talk") talkWindowTargets.set(w.id, w.target);
  }

  // 收集"发给 user 的 outbox 消息"作为 outbound message lines。
  // 仅在 thread.creatorObjectId === "user" 时启用 — 此场景下 RightPanel 显示该 thread,
  // user 看不到 assistant 给自己发的回信(因为消息体在三段式 say tool 的 refine.args 里,
  // 单看 events 看不到内容);从 outbox 直接取已落盘的消息最可靠。
  const showOutboundToUser = thread.creatorObjectId === "user";
  const pendingOutbound = showOutboundToUser
    ? buildOutboundMessageLinesForTargets(
        thread.outbox ?? [],
        talkWindowTargets,
        (target) => target === "user",
      ).sort((a, b) => a.createdAt - b.createdAt)
    : [];
  let outboundCursor = 0;
  /** 把所有 createdAt <= maxCreatedAt 的未消费 outbound 行先 push 进去。 */
  function flushOutboundUpTo(maxCreatedAt: number): void {
    while (outboundCursor < pendingOutbound.length && pendingOutbound[outboundCursor]!.createdAt <= maxCreatedAt) {
      lines.push(pendingOutbound[outboundCursor]!.line);
      outboundCursor += 1;
    }
  }

  // 预扫描所有 function_call_output 并按 callId 建索引，让 function_call 能
  // 跨距离配对其 output（LLM 一次抛多个并行 tool_call 时，输出不会紧跟在调用之后）。
  // 同一 callId 出现多次时取首条；被消费过的 output index 标记跳过，避免渲染孤儿卡。
  const outputsByCallId = new Map<string, { event: Record<string, unknown>; index: number }>();
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (!isRecord(ev)) continue;
    if (ev.category === "tool_runtime" && ev.kind === "function_call_output" && typeof ev.callId === "string") {
      if (!outputsByCallId.has(ev.callId)) outputsByCallId.set(ev.callId, { event: ev, index: i });
    }
  }
  const consumedOutputIndices = new Set<number>();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isRecord(event)) continue;

    const category = typeof event.category === "string" ? event.category : undefined;
    const kind = typeof event.kind === "string" ? event.kind : undefined;

    if (category === "context_change" && kind === "inbox_message_arrived") {
      const message = findInboxMessage(thread, typeof event.msgId === "string" ? event.msgId : undefined);
      // 兼容 canonical `content` 字段和 legacy `text` 字段
      const body = message && ((message as any).content ?? (message as any).text);
      if (body) {
        // 先把所有早于这条 inbox 的 outbound→user 消息 push 进去,实现时间穿插
        if (message.createdAt !== undefined) flushOutboundUpTo(message.createdAt);
        lines.push({
          id: typeof event.msgId === "string" ? event.msgId : `event-${index}`,
          kind: "message",
          role: "user",
          content: body,
          senderLabel: senderLabelOf(message),
        });
      }
      continue;
    }

    if (category === "llm_interaction" && kind === "text" && typeof event.text === "string") {
      lines.push({ id: `event-${index}`, kind: "message", role: "assistant", content: event.text });
      continue;
    }

    if (category === "context_change" && kind === "inject" && typeof event.text === "string") {
      const meta: string[] = [];
      const ev = event as { source?: string; errorCode?: string; dataPreview?: string };
      if (ev.source) meta.push(`source: ${ev.source}`);
      if (ev.errorCode) meta.push(`errorCode: ${ev.errorCode}`);
      if (ev.dataPreview) meta.push(`dataPreview: ${ev.dataPreview}`);
      const content = meta.length > 0 ? `${event.text}\n\n(${meta.join("; ")})` : event.text;
      lines.push({
        id: `event-${index}`,
        kind: "notice",
        role: "notice",
        title: "Context update",
        content,
        tone: isErrorText(event.text) ? "error" : "info",
      });
      continue;
    }

    if (category === "llm_interaction" && kind === "function_call") {
      const callId = typeof event.callId === "string" ? event.callId : undefined;
      const matched = callId ? outputsByCallId.get(callId) : undefined;
      if (matched) consumedOutputIndices.add(matched.index);

      // 如果是 exec(method=say) 并且 parent_window 是个 talk_window,
      // 把"对外发出的消息内容"提升为可读的 message line(在 tool card 之前)。
      // 这样 assistant ↔ user 的 thread 上能直接看到双方对话,不必去翻 tool args JSON。
      const sayLine = maybeBuildOutboundSayLine(event, callId ?? `event-${index}`, talkWindowTargets);
      if (sayLine) lines.push(sayLine);

      lines.push(buildToolLine({
        id: callId ?? `event-${index}`,
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        callId,
        argumentsValue: event.arguments,
        outputValue: matched?.event.output,
        ok: matched ? Boolean(matched.event.ok) : undefined,
        pending: !matched,
      }));
      continue;
    }

    if (category === "tool_runtime" && kind === "function_call_output") {
      // 已被某个 function_call 通过 callId 索引消费过 → 跳过，避免渲染空的孤儿卡。
      if (consumedOutputIndices.has(index)) continue;
      lines.push(buildToolLine({
        id: typeof event.callId === "string" ? `${event.callId}-output` : `event-${index}`,
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        callId: typeof event.callId === "string" ? event.callId : undefined,
        outputValue: event.output,
        ok: typeof event.ok === "boolean" ? event.ok : undefined,
      }));
      continue;
    }

    if (category === "llm_interaction" && kind === "tool_use") {
      lines.push(buildToolLine({
        id: `event-${index}`,
        toolName: typeof event.toolName === "string" ? event.toolName : "tool",
        argumentsValue: event.arguments,
        pending: true,
      }));
      continue;
    }

    if (category === "llm_interaction" && kind === "thinking" && typeof event.text === "string") {
      lines.push({
        id: `event-${index}`,
        kind: "notice",
        role: "notice",
        title: "Thinking",
        content: event.text,
        tone: "warning",
      });
      continue;
    }

    if (category === "permission" && kind === "permission_ask") {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
      const command = typeof event.method === "string" ? event.method : "(unknown)";
      const argsSummary = typeof event.argsSummary === "string" ? event.argsSummary : undefined;
      const windowId = typeof event.windowId === "string" ? event.windowId : undefined;
      // decided 写在 same event 上 (backend mutates in place); kind=permission_denied 是另一种
      // 系统级拒绝路径, 不会带 decided. 这里只读 same-event.decided.action.
      let decided: "approve" | "reject" | undefined;
      const decidedRecord = isRecord(event.decided) ? event.decided : undefined;
      if (decidedRecord && (decidedRecord.action === "approve" || decidedRecord.action === "reject")) {
        decided = decidedRecord.action;
      }
      lines.push({
        id: toolCallId ? `permission-${toolCallId}` : `event-${index}`,
        kind: "permission_card",
        role: "notice",
        toolCallId,
        method: command,
        argsSummary,
        windowId,
        decided,
      });
      continue;
    }

    lines.push(fallbackNotice(index, event));
  }

  // 处理完所有 events 后,flush 剩余 outbound→user 消息(比最后一个 inbox 还晚的)
  flushOutboundUpTo(Number.POSITIVE_INFINITY);

  // 把连续的 open → refine / submit / close（同一 window_id）合并成一张卡，
  // followUps 渲染在主卡下面的紧凑 step 行（详见 TuiBlock）。
  return groupConsecutiveToolLines(lines);
}
