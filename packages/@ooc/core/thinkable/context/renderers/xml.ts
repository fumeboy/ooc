/**
 * XmlRenderer — renders a ContextSnapshot to the XML format used by the LLM.
 *
 * Replaces the old renderContextXml function.
 * Structure:
 *   <context>
 *     <self object_id="..."/>
 *     <thread id="..." status="...">
 *       <creator_thread_id>...</creator_thread_id>
 *       <parent_thread_id>...</parent_thread_id>
 *       <context_windows>
 *         <window id class status [sharing read_only]>
 *           <title>...</title>
 *           ... type-specific content (readable / compressView)
 *           <commands hint="...">...</commands>
 *           <sub_windows>...</sub_windows>?
 *         </window>
 *       </context_windows>
 *       <inbox><message>...</message>...</inbox>?
 *       <outbox><message>...</message>...</outbox>?
 *     </thread>
 *     <context_overflow item_count="N">
 *       <item id title relevance reason/>...
 *     </context_overflow>?
 *   </context>
 */
import type { ContextSnapshot } from "../snapshot.js";
import type { ContextWindow } from "../../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID } from "../../../executable/windows/_shared/types.js";
import {
  type RenderContext,
  type ObjectRegistry,
  type ObjectDefinition,
} from "../../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../../executable/windows/index.js";
import { extractBasicDescription, conciseDescription } from "../../../executable/windows/_shared/method-description.js";
import type { ThreadContext, ThreadMessage } from "../index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import { loadObjectWindow } from "../../../runtime/server-loader.js";
import { readReadable, resolveStoneIdentityRef, type StoneObjectRef } from "../../../persistable/index.js";
import {
  appendNode,
  optionalElement,
  serializeXml,
  xmlComment,
  xmlElement,
  xmlText,
  type XmlNode,
} from "@ooc/core/_shared/types/xml.js";

// ─────────────────────────── helpers (inbox/outbox) ──────────────────────────

function messageBody(message: ThreadMessage): string {
  return (message as any).content ?? (message as any).text ?? "";
}

function renderMessagesNode(tag: "inbox" | "outbox", messages: ThreadMessage[] | undefined): XmlNode | null {
  if (!messages || messages.length === 0) return null;

  return xmlElement(
    tag,
    {},
    messages.map((message) =>
      xmlElement("message", { id: message.id }, [
        xmlElement("from_thread_id", {}, [xmlText(message.fromThreadId)]),
        xmlElement("to_thread_id", {}, [xmlText(message.toThreadId)]),
        xmlElement("content", {}, [xmlText(messageBody(message))]),
        xmlElement("source", {}, [xmlText(message.source)]),
        xmlElement("created_at", {}, [xmlText(String(message.createdAt))]),
      ]),
    ),
  );
}

// ─────────────────────────── commands node ───────────────────────────────────

const COMMAND_BRIEF_MAX = 80;
const COMMAND_DESC_MAX = 200;

/**
 * 把 method schema 的**必填**参数渲染为 `<arg name type required[ enum]>description</arg>` 子节点。
 * 只渲染 required===true 的参数（可选参数不进 eager）；无 schema / 无必填参数 → 空数组（行为同旧版仅 brief）。
 * enum 作属性带上（治「猜值」）；fail-soft 不抛。
 */
function renderRequiredArgNodes(schema: { args?: Record<string, import("@ooc/core/_shared/types/intent.js").MethodArgSpec> } | undefined): XmlNode[] {
  const args = schema?.args;
  if (!args) return [];
  const nodes: XmlNode[] = [];
  for (const [name, spec] of Object.entries(args)) {
    if (spec?.required !== true) continue;
    const attrs: Record<string, string> = { name, type: spec.type, required: "true" };
    if (spec.enum && spec.enum.length > 0) {
      attrs.enum = spec.enum.map(String).join("|");
    }
    const desc = spec.description;
    nodes.push(xmlElement("arg", attrs, desc ? [xmlText(desc)] : []));
  }
  return nodes;
}

/**
 * 算某 window 的**可见方法集**并渲染成 `<method>` 节点。class 级事实（方法契约）——
 * 与具体实例无关，因此抽成纯函数，供 class 声明层（renderWindowClassesNode）按 class 调用一次。
 *
 * 含 for_reflectable / inSuperFlow 门控、def.methods + def.windowMethods 合并、brief、必填 arg。
 * compress 的 `expand` 提示**不**在此（那是实例态，贴 <compressed> 节点就地说）。
 *
 * fail-soft：未注册 class（peer stone 后台注册中 / 新建对象未注册 / builtin 缺失）返回 null。
 *
 * @returns `{ methodNodes, methodNames }`——methodNodes 为排好序的 `<method>` 节点，
 *          methodNames 为同序方法名（供一致性断言/分组）。
 */
export function computeVisibleMethodSet(
  window: ContextWindow,
  thread: ThreadContext,
  registry: ObjectRegistry,
): { methodNodes: XmlNode[]; methodNames: string[] } | null {
  if (!registry.has(window.class)) return null;
  const def = registry.getObjectDefinition(window.class as never);
  // for_reflectable 门控：标记的 reflectable 沉淀方法仅在 super flow（反思 session）下 surface。
  // 非 super 时从菜单剔除（取代旧的 exec 内 isSuperSessionId 命令式拒绝 —— 存在即有效）。
  const inSuperFlow = isSuperSessionId(thread.persistence?.sessionId ?? "");
  const visibleObjectMethods = Object.keys(def.methods ?? {}).filter(
    (n) => inSuperFlow || !def.methods?.[n]?.for_reflectable,
  );
  // object method（控制 object，归 executable）+ window method（控制展示，归 readable）
  // 统一呈现给 LLM —— exec 入口相同，LLM 不需区分两类。
  const names = [
    ...visibleObjectMethods,
    ...Object.keys(def.windowMethods ?? {}),
  ];
  names.sort();

  const methodNodes: XmlNode[] = names.map((name) => {
    const entry = def.methods?.[name] ?? def.windowMethods?.[name];
    // 优先展示语义描述（method 的 *_BASIC 知识），让 LLM 看懂每个 method 的含义；
    // 无描述时退回 paths 简述（仅别名，价值低）。
    const desc = entry ? extractBasicDescription(entry) : undefined;
    const brief = desc
      ? conciseDescription(desc, COMMAND_DESC_MAX)
      : (entry?.description ?? (entry?.intents ?? [name]).join(", ")).slice(0, COMMAND_BRIEF_MAX);
    // 必填参数 eager 摆出完整契约（name+type+required+description[+enum]）治 false confidence：
    // LLM 在决策点填 args 前就看到真相，不靠先验猜 key/值。可选参数不进 eager（走 form tip / brief 正文）。
    const argNodes = renderRequiredArgNodes(entry?.schema);
    return xmlElement("method", { name }, [xmlText(brief), ...argNodes]);
  });

  return { methodNodes, methodNames: names };
}

/**
 * class 声明层：本轮 context 中出现过的每个 window class，方法契约在此**声明一次**——
 * 取代旧的「每实例抄一遍 <methods>」（28% 纯重复）。实例 window 只带 `class=` 引用此声明。
 *
 * 收集 snapshot.windows（**展平含 sub_windows**，method_exec form 等子窗口的 class 也要进）。
 * 分组 key = class 名；同 class 的多个实例**断言可见方法集一致**，不一致则 fail-soft 裂组
 * （`<class name="X#2">`），既不抹掉差异也不崩。
 *
 * fail-soft：未注册 class 的实例不进声明层（其方法本就 null）。无任何可声明 class → 返回 null。
 */
function renderWindowClassesNode(
  windows: ContextWindow[],
  thread: ThreadContext,
  registry: ObjectRegistry,
): XmlNode | null {
  // 按 class 名分组：每个 class 记录首次出现的方法集签名 + 节点。
  // 同 class 的后续实例若签名不一致（未来 per-instance 门控可能引入）→ fail-soft 裂组为
  // `<class name="X#2">`，既不抹掉差异也不崩。现状无 per-instance 门控，恒一致 → 不裂组。
  interface ClassVariant {
    name: string;
    signature: string;
    nodes: XmlNode[];
  }
  // class 名 → 已见变体列表（绝大多数情形长度 1）。
  const byClass = new Map<string, ClassVariant[]>();
  const ordered: ClassVariant[] = [];

  for (const w of windows) {
    const set = computeVisibleMethodSet(w, thread, registry);
    if (!set) continue; // 未注册 class：无方法契约可声明
    if (set.methodNames.length === 0) continue; // 无可见方法：不进声明层

    const signature = set.methodNames.join(",");
    const variants = byClass.get(w.class) ?? [];
    if (variants.some((v) => v.signature === signature)) continue; // 同 class 同方法集：已声明，去重

    const name = variants.length === 0 ? w.class : `${w.class}#${variants.length + 1}`;
    const variant: ClassVariant = { name, signature, nodes: set.methodNodes };
    variants.push(variant);
    byClass.set(w.class, variants);
    ordered.push(variant);
  }

  if (ordered.length === 0) return null;

  return xmlElement(
    "window_classes",
    {
      hint: "exec(window_id, method, args={...})。每个 class 的方法对其全部实例可用",
    },
    ordered.map((v) => xmlElement("class", { name: v.name }, v.nodes)),
  );
}

// ─────────────────────────── readable resolution ─────────────────────────────

const BUILTIN_TYPES = new Set([
  "root", "method_exec", "do", "todo", "talk", "program",
  "file", "knowledge", "search", "skill_index",
  "feishu_chat", "feishu_doc", "plan",
]);

async function resolveReadableForType(
  classType: string,
  window: ContextWindow,
  renderCtx: RenderContext,
  _thread: ThreadContext,
  persistence: { baseDir: string; sessionId?: string } | undefined,
  registry: ObjectRegistry,
): Promise<XmlNode[] | undefined> {
  // Step 1: registry.readable (builtin types)
  try {
    const def = registry.getObjectDefinition(classType as any);
    if (def.readable) {
      return await def.readable(renderCtx);
    }
  } catch {
    // continue
  }

  if (!persistence) return undefined;

  // session-aware：classType 可能是本 session 新建对象（落 worktree 未合 main）——经
  // resolveStoneIdentityRef(read) 路由到 worktree 读其 readable / executable window，
  // 否则裸 main ref 取不到 → 渲染落 placeholder。super / 无 session / 未建 worktree → main。
  const stoneRef: StoneObjectRef = await resolveStoneIdentityRef(
    { baseDir: persistence.baseDir, sessionId: persistence.sessionId, objectId: classType },
    "read",
  );

  // Step 2: stone `export const window`.readable（loader 已把独立 readable.ts 合并进此字段）
  try {
    const objWin = await loadObjectWindow(stoneRef);
    if (objWin?.readable) {
      return await objWin.readable(renderCtx);
    }
  } catch { /* continue */ }

  // Step 3: readable.md static content
  try {
    const readableText = await readReadable(stoneRef);
    if (readableText && readableText.trim().length > 0) {
      return [xmlElement("readable", {}, [xmlText(readableText)])];
    }
  } catch { /* continue */ }

  return undefined;
}

async function resolveObjectReadable(
  window: ContextWindow,
  renderCtx: RenderContext,
  thread: ThreadContext,
  registry: ObjectRegistry,
): Promise<XmlNode[] | undefined> {
  if (BUILTIN_TYPES.has(window.class)) {
    return resolveReadableForType(window.class, window, renderCtx, thread, undefined, registry);
  }

  const persistence = thread.persistence;
  if (!persistence) return undefined;

  const selfResult = await resolveReadableForType(window.class, window, renderCtx, thread, persistence, registry);
  if (selfResult) return selfResult;

  for (const ancestorType of registry.resolveParentClassChain(window.class as any)) {
    const ancestorResult = await resolveReadableForType(
      ancestorType, window, renderCtx, thread, persistence, registry,
    );
    if (ancestorResult) return ancestorResult;
  }

  return [
    xmlElement(
      "readable",
      { source: "placeholder" },
      [xmlText(`Object "${window.id}" 没有可渲染的 readable 内容（包括 parentClass 继承链）。`)],
    ),
  ];
}

// ─────────────────────────── window node rendering ───────────────────────────

async function renderWindowNode(
  window: ContextWindow,
  thread: ThreadContext,
  allWindows: ContextWindow[],
  registry: ObjectRegistry,
): Promise<XmlNode> {
  const sharingState = window.sharing;
  const renderedWindow: ContextWindow = sharingState ? (sharingState.snapshot as ContextWindow) : window;

  const titlePrefix = sharingState
    ? sharingState.kind === "ref"
      ? `[ref → owner@thread:${sharingState.ownerThreadId}] `
      : `[已借给 thread:${sharingState.borrowerThreadId}] `
    : "";

  const children: XmlNode[] = [
    xmlElement("title", {}, [xmlText(titlePrefix + renderedWindow.title)]),
  ];

  // fail-soft：未注册 type（peer stone 后台注册中 / 新建对象 / builtin 缺失）→ def undefined，
  // 走下方 resolveObjectReadable 从 stone 磁盘加载 readable 渲染，不在此 getObjectDefinition 抛崩 think loop。
  // （collaborable world 级 think 崩根因：peer window 的 type=peer objectId，撞未注册 peer 即整轮 think_error。）
  let def: ObjectDefinition | undefined;
  try {
    def = registry.getObjectDefinition(renderedWindow.class as never);
  } catch {
    def = undefined;
  }
  const compressLevel = (renderedWindow.compressLevel ?? 0) as 0 | 1 | 2;
  const renderCtx: RenderContext = { thread, window: renderedWindow };

  if (compressLevel === 1 || compressLevel === 2) {
    if (def?.compressView) {
      const typeChildren = await def.compressView(renderCtx, compressLevel);
      children.push(...typeChildren);
      // expand 提示就地贴在压缩实例上（方法菜单已搬去 class 声明层，不再随实例渲染 expand method）。
      children.push(
        xmlElement(
          "compressed",
          { level: String(compressLevel) },
          [xmlText(`本 window 处于压缩态(level=${compressLevel})。exec(window_id="${renderedWindow.id}", method="expand") 恢复完整内容。`)],
        ),
      );
    } else {
      children.push(
        xmlElement(
          "compressed",
          { level: String(compressLevel) },
          [
            xmlText(
              `本 window 处于压缩态(level=${compressLevel}); class "${renderedWindow.class}" 未注册 compressView hook。exec(window_id="${renderedWindow.id}", method="expand") 恢复完整内容。`,
            ),
          ],
        ),
      );
    }
  } else {
    const readableChildren = await resolveObjectReadable(renderedWindow, renderCtx, thread, registry);
    if (readableChildren) {
      children.push(...readableChildren);
    } else {
      // fail-soft：readable hook 无产出（未注册 type / 无 persistence / 磁盘 readable 取不到）——占位不崩。
      children.push(
        xmlElement("readable", { source: def ? "empty" : "unregistered" }, [
          xmlText(`Object type "${renderedWindow.class}" 无 readable 产出（stone 可能后台注册中或新建未就绪）。`),
        ]),
      );
    }
  }

  // 方法契约不再逐实例渲染：class 级声明一次在 <window_classes>（renderWindowClassesNode），
  // 实例只带 class= 引用。compress 态的 expand 提示就地贴在上方 <compressed> 节点，不在此。

  const subWindows = allWindows.filter((w) => w.parentWindowId === window.id);
  if (subWindows.length > 0) {
    const subNodes = await Promise.all(
      subWindows.map((sub) => renderWindowNode(sub, thread, allWindows, registry)),
    );
    children.push(xmlElement("sub_windows", {}, subNodes));
  }

  const attrs: Record<string, string> = {
    id: window.id,
    class: window.class,
    status: window.status,
  };
  if (sharingState) {
    attrs.read_only = "true";
    attrs.sharing = sharingState.kind;
    if (sharingState.kind === "ref") {
      attrs.owner_thread = sharingState.ownerThreadId;
    } else {
      attrs.borrower_thread = sharingState.borrowerThreadId;
    }
  }

  return xmlElement("window", attrs, children);
}

async function renderContextWindowsNode(
  windows: ContextWindow[],
  thread: ThreadContext,
  registry: ObjectRegistry,
): Promise<XmlNode | null> {
  if (windows.length === 0) return null;

  const topLevel = windows.filter((w) => !w.parentWindowId || w.parentWindowId === ROOT_WINDOW_ID);
  const children = await Promise.all(topLevel.map((w) => renderWindowNode(w, thread, windows, registry)));
  return xmlElement("context_windows", {}, children);
}

/**
 * 收集所有 window 在其 transcript 视图中已消费的 inbox/outbox 消息 id，用于去重
 * 顶层 inbox/outbox fallback。
 *
 * 由 registry 派发——每个 window type 通过 ObjectDefinition.consumedMessageIds hook 自报
 * 已消费的消息（do/talk 复用各自的 filterMessagesFor*Window）。renderer 不直接 import
 * executable/windows/{do,talk}，消除 thinkable→executable 反向耦合。
 */
function collectWindowConsumedMessageIds(
  windows: ContextWindow[],
  thread: ThreadContext,
  registry: ObjectRegistry,
): Set<string> {
  const consumed = new Set<string>();
  for (const w of windows ?? []) {
    let def: ObjectDefinition | undefined;
    try {
      def = registry.getObjectDefinition(w.class as never);
    } catch {
      def = undefined;
    }
    if (!def?.consumedMessageIds) continue;
    for (const m of def.consumedMessageIds({ thread, window: w })) {
      consumed.add(m.id);
    }
  }
  return consumed;
}

// ─────────────────────────── self nodes ──────────────────────────────────────

function renderSelfNodes(objectId: string | undefined): XmlNode[] {
  if (!objectId) return [];
  return [xmlElement("self", { object_id: objectId })];
}

// ─────────────────────────── XmlRenderer class ───────────────────────────────

export class XmlRenderer {
  private registry: ObjectRegistry;

  constructor(registry?: ObjectRegistry) {
    this.registry = registry ?? builtinRegistry;
  }

  async render(snapshot: ContextSnapshot, thread: ThreadContext): Promise<string> {
    // Use snapshot.windows (already budget-allocated) for rendering
    const windows = snapshot.windows;
    const threadForRender: ThreadContext = {
      ...thread,
      contextWindows: windows,
    };

    const threadChildren: XmlNode[] = [];
    appendNode(threadChildren, optionalElement("creator_thread_id", threadForRender.creatorThreadId));
    appendNode(threadChildren, optionalElement("parent_thread_id", threadForRender.parentThreadId));

    // class 声明层：本轮出现的每个 window class 的方法契约声明一次，插在 <context_windows> 之前。
    // 实例 window 只带 class= 引用此声明，不再逐实例重复方法菜单。
    appendNode(threadChildren, renderWindowClassesNode(windows, threadForRender, this.registry));

    const contextWindowsNode = await renderContextWindowsNode(windows, threadForRender, this.registry);
    if (contextWindowsNode) {
      threadChildren.push(xmlComment("context windows: persistent or in-flight windows the LLM is currently interacting with (knowledge synthesized as knowledge_window with source=protocol|activator|explicit)"));
      threadChildren.push(contextWindowsNode);
    }

    // Top-level inbox/outbox fallback
    const consumedMsgIds = collectWindowConsumedMessageIds(windows, threadForRender, this.registry);
    const fallbackInbox = (threadForRender.inbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
    const fallbackOutbox = (threadForRender.outbox ?? []).filter((m) => !consumedMsgIds.has(m.id));
    appendNode(threadChildren, renderMessagesNode("inbox", fallbackInbox));
    appendNode(threadChildren, renderMessagesNode("outbox", fallbackOutbox));

    const rootChildren: XmlNode[] = [
      ...renderSelfNodes(threadForRender.persistence?.objectId),
      xmlElement("thread", { id: threadForRender.id, status: threadForRender.status }, threadChildren),
    ];

    // <context_overflow> section
    if (snapshot.overflow.length > 0) {
      const overflowNodes: XmlNode[] = snapshot.overflow.map((o) => ({
        kind: "element",
        tag: "item",
        attrs: {
          id: o.id,
          title: o.title,
          relevance: o.relevance.toFixed(2),
          reason: o.reason,
        },
      }));

      rootChildren.push({
        kind: "element",
        tag: "context_overflow",
        attrs: {
          item_count: String(snapshot.overflow.length),
        },
        children: overflowNodes,
      });
    }

    const root: XmlNode = {
      kind: "element",
      tag: "context",
      attrs: {},
      children: rootChildren,
    };

    return serializeXml(root);
  }
}
