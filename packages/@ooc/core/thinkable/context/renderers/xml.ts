/**
 * XmlRenderer — renders a ContextSnapshot to the XML format used by the LLM.
 *
 * Wave 4 对象模型：thread 持 `OocObjectInstance`（身份元信息 + 业务 data + 投影态 win），
 * 渲染走 **readable 投影**：
 *   `resolveReadable(inst.class)?.readable(ctx, inst.data, inst.win)` → `ReadableProjection{class, content}`
 * —— class 是动态投影窗 class（同 object 不同视角可不同），content 是 `XmlNode[]`（直接用）或 string
 * （包成 xml 文本节点）。无 Class.readable 时回退读盘 readable.md 静态内容。
 *
 * 方法契约声明层（<window_classes>）按 **投影 class** 声明一次：该投影窗展示哪些 object method
 * （decl.object_methods 引用 executable）+ window method（decl.window_methods）。
 *
 * Structure:
 *   <context>
 *     <self object_id="..."/>
 *     <thread id="..." status="...">
 *       <creator_thread_id>...</creator_thread_id>
 *       <parent_thread_id>...</parent_thread_id>
 *       <window_classes>...</window_classes>?
 *       <context_windows>
 *         <window id class status>
 *           <title>...</title>
 *           ... readable 投影 content
 *           <sub_windows>...</sub_windows>?
 *         </window>
 *       </context_windows>
 *       <inbox>...</inbox>? <outbox>...</outbox>?
 *     </thread>
 *     <context_overflow item_count="N">...</context_overflow>?
 *   </context>
 */
import type { ContextSnapshot } from "../snapshot.js";
import type { OocObjectInstance } from "../../../runtime/ooc-class.js";
import { ROOT_WINDOW_ID } from "../../../_shared/types/context-window.js";
import {
  builtinRegistry,
  type ObjectRegistry,
} from "../../../runtime/object-registry.js";
import type { ReadableContext, ReadableProjection } from "../../../readable/contract.js";
import { extractBasicDescription, conciseDescription } from "@ooc/core/thinkable/context/method-description.js";
import type { ThreadContext, ThreadMessage } from "../index.js";
import { isSuperSessionId } from "@ooc/core/_shared/types/constants.js";
import { readReadable, resolveStoneIdentityRef, type StoneObjectRef } from "../../../persistable/index.js";
import { persistableCtx, runtimeObjectRef } from "../../../persistable/object-data.js";
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

function renderMessagesNode(tag: "inbox" | "outbox", messages: ThreadMessage[] | undefined): XmlNode | null {
  if (!messages || messages.length === 0) return null;

  return xmlElement(
    tag,
    {},
    messages.map((message) =>
      xmlElement("message", { id: message.id }, [
        xmlElement("from_thread_id", {}, [xmlText(message.fromThreadId)]),
        xmlElement("to_thread_id", {}, [xmlText(message.toThreadId)]),
        xmlElement("content", {}, [xmlText(message.content)]),
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
 * 只渲染 required===true 的参数（可选参数不进 eager）；无 schema / 无必填参数 → 空数组。
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
 * 算某**投影窗 class** 的可见方法集并渲染成 `<method>` 节点。
 *
 * 新对象模型：readable 把 object 投影成 window 后，`resolveWindowClass(ownerClass, projectionClass)`
 * 给出该投影窗展示哪些 object method（decl.object_methods 引用 executable）+ window method
 * （decl.window_methods）。object method 沿继承链合并（resolveObjectMethods）后按引用名挑选；
 * window method 直接取自 decl。两类统一呈现，exec 入口相同、LLM 不需区分。
 *
 * for_reflectable 门控：标记的 object method 仅在 super flow（反思 session）下 surface，
 * 非 super 从菜单剔除。
 *
 * fail-soft：未注册 ownerClass / 无该投影窗声明 → 返回 null（无方法契约可声明）。
 *
 * @returns `{ methodNodes, methodNames }`——methodNodes 为排好序的 `<method>` 节点，
 *          methodNames 为同序方法名（供一致性断言/分组）。
 */
export function computeVisibleMethodSet(
  ownerClass: string,
  projectionClass: string,
  thread: ThreadContext,
  registry: ObjectRegistry,
  isSelf = false,
): { methodNodes: XmlNode[]; methodNames: string[] } | null {
  const decl = registry.resolveWindowClass(ownerClass, projectionClass);
  // self 窗 = 对象自己的命令面：surface 其**全部自有 object method**（沿继承链合并），无需在
  // readable 里冗余声明 WindowClassDecl——否则对象自定义的 object method（含 route 填表方法）对自己
  // 的 LLM 不可发现。非 self 窗（member/peer）仍按 decl.object_methods 门控（窗可只露子集）。
  if (!decl && !isSelf) return null;

  // for_reflectable 门控：reflectable 沉淀 method 仅在 super flow（反思 session）下 surface。
  const inSuperFlow = isSuperSessionId(thread.persistence?.sessionId ?? "");

  type AnyMethod =
    | import("../../../executable/contract.js").ObjectMethod
    | import("../../../readable/contract.js").WindowMethod;
  const merged = new Map<string, AnyMethod>();

  // object method：沿继承链合并。self 窗取全部自有方法名；非 self 按 decl.object_methods 引用名挑选。
  const objectMethods = new Map(
    registry.resolveObjectMethods(ownerClass).map((m) => [m.name, m]),
  );
  const objectMethodNames = isSelf ? [...objectMethods.keys()] : decl!.object_methods;
  for (const name of objectMethodNames) {
    const m = objectMethods.get(name);
    if (!m) continue; // 引用了不存在的 method：fail-soft 跳过
    if (!inSuperFlow && (m as any).for_reflectable) continue;
    merged.set(name, m);
  }
  // window method：取自该投影窗声明（self 窗若也有 decl 则一并合入，如 viewport 类展示方法）。
  // compress v2：无通用默认窗方法表——菜单只含 class 自声明的 window method（compress/resize 协议各 class 自实现）。
  for (const wm of decl?.window_methods ?? []) {
    if (merged.has(wm.name)) continue;
    merged.set(wm.name, wm);
  }

  if (merged.size === 0) return null;
  const names = [...merged.keys()].sort();

  const methodNodes: XmlNode[] = names.map((name) => {
    const entry = merged.get(name);
    // 优先展示语义描述（method 的 description），让 LLM 看懂每个 method 的含义。
    const desc = entry ? extractBasicDescription(entry) : undefined;
    const brief = desc
      ? conciseDescription(desc, COMMAND_DESC_MAX)
      : (entry?.description ?? name).slice(0, COMMAND_BRIEF_MAX);
    // 必填参数 eager 摆出完整契约治 false confidence：LLM 填 args 前就看到真相。
    const argNodes = renderRequiredArgNodes(entry?.schema);
    return xmlElement("method", { name }, [xmlText(brief), ...argNodes]);
  });

  return { methodNodes, methodNames: names };
}

/**
 * class 声明层：本轮 context 中出现过的每个**投影窗 class**，方法契约在此**声明一次**——
 * 实例 window 只带 `class=` 引用此声明。
 *
 * 输入是已算出的 `{ ownerClass, projectionClass }` 对（projection 已先于此层算出）。
 * 分组 key = projectionClass；同 class 的多个实例**断言可见方法集一致**，不一致则 fail-soft 裂组
 * （`<class name="X#2">`），既不抹掉差异也不崩。
 *
 * fail-soft：无声明的投影窗不进声明层。无任何可声明 class → 返回 null。
 */
function renderWindowClassesNode(
  projected: Array<{ ownerClass: string; projectionClass: string; isSelf?: boolean }>,
  thread: ThreadContext,
  registry: ObjectRegistry,
): XmlNode | null {
  interface ClassVariant {
    name: string;
    signature: string;
    nodes: XmlNode[];
  }
  const byClass = new Map<string, ClassVariant[]>();
  const ordered: ClassVariant[] = [];

  for (const { ownerClass, projectionClass, isSelf } of projected) {
    const set = computeVisibleMethodSet(ownerClass, projectionClass, thread, registry, isSelf);
    if (!set) continue; // 无方法契约可声明
    if (set.methodNames.length === 0) continue; // 无可见方法：不进声明层

    const signature = set.methodNames.join(",");
    const variants = byClass.get(projectionClass) ?? [];
    if (variants.some((v) => v.signature === signature)) continue; // 同 class 同方法集：去重

    const name = variants.length === 0 ? projectionClass : `${projectionClass}#${variants.length + 1}`;
    const variant: ClassVariant = { name, signature, nodes: set.methodNodes };
    variants.push(variant);
    byClass.set(projectionClass, variants);
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

// ─────────────────────────── readable projection ─────────────────────────────

/** 把 ReadableProjection.content（XmlNode[] | string）规整成 XmlNode[] 子节点。 */
function projectionContentNodes(content: XmlNode[] | string): XmlNode[] {
  if (typeof content === "string") {
    return [xmlElement("readable", {}, [xmlText(content)])];
  }
  return content;
}

/** level 1 缩略的文本上限（魔数常量；超过才缩略，短窗原样）。 */
const COMPRESS_LEVEL1_MAX_CHARS = 200;

/** 递归收集节点纯文本（level 1 缩略用）。 */
function collectNodeText(nodes: XmlNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.value;
    else if (n.kind === "element" && n.children) out += collectNodeText(n.children);
  }
  return out;
}

/**
 * 按窗的 `compressLevel` 投影内容详略 —— `resize` 的**读出侧**（compress v2：resize 设档位，无 expand）。
 * - 0 / undefined：原样全文
 * - 1：缩略——拍平为截断文本（{@link COMPRESS_LEVEL1_MAX_CHARS}）+ 还原提示；未超限则原样
 * - 2：仅句柄——丢弃内容，只留折叠占位（title 在调用侧已 push）
 */
export function projectByCompressLevel(nodes: XmlNode[], level: 0 | 1 | 2 | undefined): XmlNode[] {
  if (!level) return nodes;
  if (level >= 2) {
    return [
      xmlElement("compressed", { level: "2" }, [
        xmlText("(窗已折叠为句柄；exec(method=resize, level=0) 还原全文)"),
      ]),
    ];
  }
  const text = collectNodeText(nodes);
  if (text.length <= COMPRESS_LEVEL1_MAX_CHARS) return nodes;
  return [
    xmlElement("compressed", { level: "1" }, [
      xmlText(text.slice(0, COMPRESS_LEVEL1_MAX_CHARS) + " …（已缩略；exec(method=resize, level=0) 还原全文）"),
    ]),
  ];
}

/**
 * 算一个 object 实例的 readable 投影。
 *
 * 1) `resolveReadable(inst.class)` 命中 → 调 `readable(ctx, inst.data, inst.win)` 取投影。
 * 2) 无 Class.readable → 回退读盘 readable.md 静态内容（投影 class 即 inst.class）。
 * 3) 都无 → placeholder 投影（投影 class 即 inst.class）。
 *
 * fail-soft：任何一步抛错都不崩 think loop，落 placeholder。
 */
export async function resolveProjection(
  inst: OocObjectInstance,
  thread: ThreadContext,
  registry: ObjectRegistry,
  persistence: { baseDir: string; sessionId?: string } | undefined,
): Promise<ReadableProjection> {
  const readableCtx: ReadableContext = {
    thread,
    object: { id: inst.id, class: inst.class },
    persistence,
  };

  // self 门面窗 hydrate：self 门面窗注入时 data 为空（init.ts），其身份正文（self.md）由
  // **该对象的 persistable.load** 读盘——renderer 不再直接 readSelf（对象模型核心 9：self.md
  // 只属 agent 实例，读取下沉为 persistable.load 经 registry 派发）。hydrate 后 Step1 的
  // agent readable 拿到 data.self 渲身份。无 persistence / 非 self 门面窗 / 已有 data → 跳过。
  const isSelfWindow = (inst.win as { isSelfWindow?: boolean } | undefined)?.isSelfWindow === true;
  const dataEmpty = !inst.data || Object.keys(inst.data as Record<string, unknown>).length === 0;
  if (isSelfWindow && dataEmpty && persistence) {
    const load = registry.resolvePersistable(inst.class)?.load;
    const ref = runtimeObjectRef(thread, inst);
    if (load && ref) {
      try {
        const loaded = await load(persistableCtx(ref));
        if (loaded) inst = { ...inst, data: loaded };
      } catch {
        // hydrate 失败 fail-soft：data 仍为空，Step1 readable 渲空身份。
      }
    }
  }

  // Step 1: Class.readable（沿继承链解析）
  const mod = registry.resolveReadable(inst.class);
  if (mod) {
    try {
      return await mod.readable(readableCtx, inst.data, inst.win);
    } catch (err) {
      return {
        class: inst.class,
        content: [
          xmlElement("readable", { source: "error" }, [
            xmlText(`readable 投影失败：${(err as Error).message}`),
          ]),
        ],
      };
    }
  }

  // Step 2: 默认投影——渲对象**面向他人**的 readable.md（无自定义 readable module 时的 peer 视角）。
  // self 视角（self 门面窗）不再走这里：agent 的 self.md 身份由 Step1 的 agent readable module 渲，
  // 其 data.self 已在上方经 persistable.load hydrate——renderer 不再直接 readSelf。
  if (persistence) {
    try {
      const stoneRef: StoneObjectRef = await resolveStoneIdentityRef(
        { baseDir: persistence.baseDir, sessionId: persistence.sessionId, objectId: inst.id },
        "read",
      );
      const text = await readReadable(stoneRef);
      if (text && text.trim().length > 0) {
        return { class: inst.class, content: text };
      }
    } catch {
      // continue to empty window
    }
  }

  // Step 3: 默认空 context window（class = inst.class）——对象无身份文件可渲，不输出 placeholder 文案。
  return { class: inst.class, content: [] };
}

// ─────────────────────────── window node rendering ───────────────────────────

async function renderWindowNode(
  inst: OocObjectInstance,
  projection: ReadableProjection,
  thread: ThreadContext,
  allWindows: Array<{ inst: OocObjectInstance; projection: ReadableProjection }>,
): Promise<XmlNode> {
  const children: XmlNode[] = [xmlElement("title", {}, [xmlText(inst.title)])];

  // resize 读出侧：按本窗 compressLevel 投影内容详略（title 已先 push，仅折叠 content）。
  const compressLevel = (inst.win as { compressLevel?: 0 | 1 | 2 } | undefined)?.compressLevel;
  children.push(...projectByCompressLevel(projectionContentNodes(projection.content), compressLevel));

  const subWindows = allWindows.filter((w) => w.inst.parentObjectId === inst.id);
  if (subWindows.length > 0) {
    const subNodes = await Promise.all(
      subWindows.map((sub) => renderWindowNode(sub.inst, sub.projection, thread, allWindows)),
    );
    children.push(xmlElement("sub_windows", {}, subNodes));
  }

  // 实例 window 带**投影 class**（方法契约在 <window_classes> 按投影 class 声明一次）。
  const attrs: Record<string, string> = {
    id: inst.id,
    class: projection.class,
    status: inst.status,
  };

  return xmlElement("window", attrs, children);
}

async function renderContextWindowsNode(
  projected: Array<{ inst: OocObjectInstance; projection: ReadableProjection }>,
  thread: ThreadContext,
): Promise<XmlNode | null> {
  if (projected.length === 0) return null;

  const topLevel = projected.filter(
    (w) => !w.inst.parentObjectId || w.inst.parentObjectId === ROOT_WINDOW_ID,
  );
  const children = await Promise.all(
    topLevel.map((w) => renderWindowNode(w.inst, w.projection, thread, projected)),
  );
  return xmlElement("context_windows", {}, children);
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
    // snapshot.windows（已 budget 分配）的元素是 object 实例。
    const windows = snapshot.windows;
    const threadForRender: ThreadContext = {
      ...thread,
      contextWindows: windows,
    };

    const persistence = threadForRender.persistence
      ? { baseDir: threadForRender.persistence.baseDir, sessionId: threadForRender.persistence.sessionId }
      : undefined;

    // 先算每个实例的 readable 投影（class 声明层 + 实例渲染都基于它）。
    const projected = await Promise.all(
      windows.map(async (inst) => ({
        inst,
        projection: await resolveProjection(inst, threadForRender, this.registry, persistence),
      })),
    );

    const threadChildren: XmlNode[] = [];
    appendNode(threadChildren, optionalElement("creator_thread_id", threadForRender.creatorThreadId));
    appendNode(threadChildren, optionalElement("parent_thread_id", threadForRender.parentThreadId));

    // class 声明层：本轮出现的每个投影窗 class 的方法契约声明一次，插在 <context_windows> 之前。
    appendNode(
      threadChildren,
      renderWindowClassesNode(
        projected.map((p) => ({
          ownerClass: p.inst.class,
          projectionClass: p.projection.class,
          // self 窗（实例 id = 本 thread 的 self objectId）：surface 对象全部自有 object method。
          isSelf: !!threadForRender.persistence?.objectId && p.inst.id === threadForRender.persistence.objectId,
        })),
        threadForRender,
        this.registry,
      ),
    );

    const contextWindowsNode = await renderContextWindowsNode(projected, threadForRender);
    if (contextWindowsNode) {
      threadChildren.push(xmlComment("context windows: persistent or in-flight windows the LLM is currently interacting with (knowledge synthesized as knowledge_window with source=protocol|activator|explicit)"));
      threadChildren.push(contextWindowsNode);
    }

    // Top-level inbox/outbox 兜底：只渲**未被任何会话窗 transcript 收纳**的消息（信息只渲一次，
    // context.md 核心 10）。各窗投影经 consumedMessageIds 报告已收纳的消息，这里统一从兜底剔除。
    const consumed = new Set<string>();
    for (const p of projected) {
      for (const id of p.projection.consumedMessageIds ?? []) consumed.add(id);
    }
    const unconsumed = (messages: ThreadMessage[] | undefined): ThreadMessage[] | undefined =>
      consumed.size === 0 ? messages : messages?.filter((m) => !consumed.has(m.id));
    appendNode(threadChildren, renderMessagesNode("inbox", unconsumed(threadForRender.inbox)));
    appendNode(threadChildren, renderMessagesNode("outbox", unconsumed(threadForRender.outbox)));

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
