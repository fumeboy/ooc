/**
 * custom_window dispatcher —— plan §6.2 / D1。
 *
 * 注册一份固定 type=`"custom"` 的 WindowRegistry 契约；commands / renderXml /
 * onClose / basicKnowledge 全部在调用瞬间从 `ctx.window.objectId` 路由到对应
 * Object 的 `stones/<objectId>/server/index.ts` 的 `export const window`
 * （ObjectWindowDefinition）。
 *
 * 关键约束（plan §8 风险 1）：
 *   commands dispatcher 在 entry.exec 包装层直接把 `self: ProgramSelf` 注入到
 *   ctx，使 manager.submit 不需要感知 custom type。
 */

import { registerObjectType, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { ObjectMethod, CommandExecutionContext, CommandKnowledgeEntries } from "../_shared/command-types.js";
import type { CustomWindow } from "../_shared/types.js";
import { loadObjectWindow } from "../../../executable/server/loader.js";
import { createProgramSelf } from "../../../executable/server/self.js";
import type { ProgramSelf } from "../../../executable/server/types.js";
import type { ObjectWindowDefinition } from "../../../executable/server/window-types.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";
import { writeFlowRelation } from "../../../persistable/index.js";
import { deliverTalkMessage } from "../../../executable/windows/talk/delivery.js";
import { SUPER_ALIAS_TARGET } from "../../../executable/windows/_shared/super-constants.js";
import { generateWindowId, type TalkWindow } from "../../../executable/windows/_shared/types.js";

function customWindowOf(window: { type: string }): CustomWindow {
  if (window.type !== "custom") {
    throw new Error(`custom dispatcher: expected window.type=custom, got ${window.type}`);
  }
  return window as CustomWindow;
}

/** 从 ctx 取出 objectId 与 thread persistence 派生 stoneRef。 */
function resolveStoneRef(window: CustomWindow, baseDir: string) {
  return { baseDir, objectId: window.objectId, stonesBranch: undefined };
}

const RELATION_EDIT_BASIC = "internal/windows/custom/edit_relation/basic";
const RELATION_EDIT_INPUT = "internal/windows/custom/edit_relation/input";
const RELATION_EDIT_LONGTERM = "internal/windows/custom/edit_relation/long_term_detail";

const EDIT_RELATION_KNOWLEDGE = `
edit_relation 用于更新本 peer object 的 relation 文件(即 self 对该 peer 的认知记录)。

参数:
- content: 必填,relation 文件完整正文(整文件替换语义,非 patch/append)
- scope:   必填,'session' | 'long_term'
  - session:   写 flows/<sid>/objects/<self>/knowledge/relations/<peer>.md(仅本 session 生效)
  - long_term: 派一条 talk message 给 super flow,由 super 写 pools/<self>/knowledge/relations/<peer>.md(跨 session 长期生效)

典型用法(一步到位,args 齐时 open 立即提交):

  // 本 session 临时记下"该 peer 偏好简短回复"
  open(parent_window_id="<peer_window_id>", command="edit_relation",
       args={ content: "## 偏好\\n- 简短回复\\n- 不要 emoji", scope: "session" })
`.trim();

const EDIT_RELATION_LONGTERM_DETAIL = `
scope="long_term" 的路径详解:

1. 本调用不直接写 relation 文件——它会派一条 talk message 到 super flow(self-reflection 分身);
2. super flow 会作为另一个 thread 收到这条消息,自行决定如何处理(典型:用 write_file 写 pools/<self>/knowledge/relations/<peer>.md);
3. 因此 long_term edit 是**异步**的:本 command 返回成功只代表消息已派送,文件落盘要等 super flow 跑完那一轮。
`.trim();

/**
 * 2026-05-28 ooc-6 Phase 6: 内置 edit_relation 命令,替换原 relation_window.edit。
 * peer object 进入 context 后,可通过 open(parent_window_id="<peer_window_id>", command="edit_relation", ...)
 * 编辑 self 对该 peer 的 relation 文件。
 */
const editRelationCommand: ObjectMethod = {
  paths: ["edit_relation", "edit_relation.session", "edit_relation.long_term"],
  match: (args) => {
    const scope = args.scope;
    if (scope === "session") return ["edit_relation", "edit_relation.session"];
    if (scope === "long_term") return ["edit_relation", "edit_relation.long_term"];
    return ["edit_relation"];
  },
  knowledge: (args, formStatus): CommandKnowledgeEntries => {
    const entries: CommandKnowledgeEntries = { [RELATION_EDIT_BASIC]: EDIT_RELATION_KNOWLEDGE };
    if (args.scope === "long_term") {
      entries[RELATION_EDIT_LONGTERM] = EDIT_RELATION_LONGTERM_DETAIL;
    }
    if (formStatus !== "open") return entries;
    const missing: string[] = [];
    if (typeof args.content !== "string" || args.content.length === 0) missing.push("content");
    if (args.scope !== "session" && args.scope !== "long_term") missing.push("scope");
    if (missing.length > 0) {
      entries[RELATION_EDIT_INPUT] =
        `edit_relation 需要 ${missing.join(" + ")};用 refine(args={ content: "...", scope: "session" | "long_term" })。`;
    }
    return entries;
  },
  exec: async (ctx: CommandExecutionContext) => {
    const thread = ctx.thread;
    if (!thread) return "[edit_relation] 缺少 thread context。";
    const window = ctx.parentWindow;
    if (!window || window.type !== "custom") {
      return "[edit_relation] 未挂载在 peer object window 上。";
    }
    if (!thread.persistence) {
      return "[edit_relation] 当前 thread 无 persistence,无法写入。";
    }

    const content = typeof ctx.args.content === "string" ? ctx.args.content : "";
    if (content.length === 0) return "[edit_relation] 缺少 content(整文件正文)。";

    const scope = ctx.args.scope;
    if (scope !== "session" && scope !== "long_term") {
      return `[edit_relation] scope 必填且只能是 'session' | 'long_term',收到 ${JSON.stringify(scope)}。`;
    }

    const peerId = (window as CustomWindow).objectId;
    if (!peerId) return "[edit_relation] peer object window 缺少 objectId。";

    const { baseDir, sessionId, objectId: selfId } = thread.persistence;

    if (scope === "session") {
      try {
        await writeFlowRelation({ baseDir, sessionId, objectId: selfId }, peerId, content);
      } catch (error) {
        return `[edit_relation] session 写入失败: ${(error as Error).message}`;
      }
      return `[edit_relation] 已更新 session 层 relation: flows/${sessionId}/objects/${selfId}/knowledge/relations/${peerId}.md`;
    }

    // scope === "long_term":派 super flow
    const existingSuperTalk = (thread.contextWindows ?? []).find(
      (w): w is TalkWindow => w.type === "talk" && w.target === SUPER_ALIAS_TARGET,
    );
    const talkWindow: TalkWindow = existingSuperTalk ?? {
      id: `w_peer_rel_super_tmp_${generateWindowId("talk").slice("w_talk_".length)}`,
      type: "talk",
      parentWindowId: "root",
      title: `relation update for ${peerId}`,
      status: "open",
      createdAt: Date.now(),
      target: SUPER_ALIAS_TARGET,
      conversationId: "",
    };
    if (!talkWindow.conversationId) talkWindow.conversationId = talkWindow.id;

    const composed =
      `请把我对 \`${peerId}\` 的长期 relation(pools/${selfId}/knowledge/relations/${peerId}.md)` +
      `更新为以下内容(整文件替换):\n\n---\n${content}\n---`;

    try {
      const result = await deliverTalkMessage({
        caller: { thread, talkWindow },
        content: composed,
        source: "talk",
      });
      return `[edit_relation] 已派送 long_term relation 更新请求到 super flow(callee thread: ${result.calleeThreadId})。super 会写入 pools/${selfId}/knowledge/relations/${peerId}.md。`;
    } catch (error) {
      return `[edit_relation] long_term 派送失败: ${(error as Error).message}`;
    }
  },
};

/** 内置命令表 — 优先于 Proxy 动态路由。 */
const builtInCommands: Record<string, ObjectMethod> = {
  edit_relation: editRelationCommand,
};

/**
 * commands 字段是一个 Proxy 风格的"按需查"字典：每次 manager 拿一条 entry 时,
 * dispatcher lazy load ObjectWindowDefinition，把对应 entry.exec 包一层，注入 self。
 *
 * 优先级：builtInCommands (如 edit_relation) > Object 自定义 commands。
 */
const customCommandsDispatcher: Record<string, ObjectMethod> = new Proxy({}, {
  get(_target, prop: string) {
    // 先检查内置命令
    if (typeof prop === "string" && builtInCommands[prop]) {
      return builtInCommands[prop];
    }
    // manager / synthesizer / activator 拿任何字符串 key 时返回一个 dispatcher entry；
    // 实际不存在的 command 在 exec 内部抛错。
    if (typeof prop !== "string") return undefined;
    if (prop === "then") return undefined; // 防 await 误以为是 thenable

    const wrapper: ObjectMethod = {
      paths: [prop],
      match: () => [prop],
      knowledge: (args, formStatus) => {
        // 同步取 knowledge 在这里只能给基础占位，详细 knowledge 由 synthesizer 异步路径补；
        // 留个钩子表示"这条 command 来自 custom window"。
        return { [`internal/windows/custom/${prop}/basic`]: `custom command "${prop}"` };
      },
      exec: async (ctx: CommandExecutionContext) => {
        const window = ctx.parentWindow;
        if (!window) return `[custom.${prop}] 缺少 parentWindow。`;
        const cw = customWindowOf(window);
        const thread = ctx.thread;
        if (!thread) return `[custom.${prop}] 缺少 thread。`;
        if (!thread.persistence) {
          return `[custom.${prop}] thread 无 persistence；无法定位 stone server`;
        }
        const stoneRef = resolveStoneRef(cw, thread.persistence.baseDir);
        let def: ObjectWindowDefinition | undefined;
        try {
          def = await loadObjectWindow(stoneRef);
        } catch (e) {
          return `[custom.${prop}] 加载失败：${(e as Error).message}`;
        }
        if (!def) return `[custom.${prop}] objectId=${cw.objectId} 没有 export const window`;
        const entry = def.commands?.[prop];
        if (!entry) {
          const avail = Object.keys(def.commands ?? {}).join(", ") || "(无)";
          return `[custom.${prop}] 不存在；当前可用：${avail}。内置命令：${Object.keys(builtInCommands).join(", ")}`;
        }
        const self: ProgramSelf = createProgramSelf(stoneRef, thread);
        return await entry.exec({ ...ctx, self } as CommandExecutionContext);
      },
    };
    return wrapper;
  },
  has(_target, prop: string) {
    if (typeof prop === "string" && builtInCommands[prop]) return true;
    return typeof prop === "string";
  },
  ownKeys() {
    return Object.keys(builtInCommands);
  },
});

/**
 * custom window 的 renderXml dispatcher。
 *
 * 路由到对应 Object 的 `ObjectWindowDefinition.renderXml`；缺失/失败时退化为
 * 一组占位 XmlNode（仍包含 objectId/title/description，让 LLM 知道这是哪个 Object 的
 * custom window，便于排查）。
 */
async function renderCustomWindow(ctx: RenderContext): Promise<XmlNode[]> {
  const cw = customWindowOf(ctx.window);
  const thread = ctx.thread;
  const children: XmlNode[] = [
    xmlElement("object_id", {}, [xmlText(cw.objectId)]),
  ];
  if (!thread.persistence) {
    children.push(xmlElement("error", {}, [xmlText("thread 无 persistence；无法加载 ObjectWindowDefinition")]));
    return children;
  }
  try {
    const def = await loadObjectWindow(resolveStoneRef(cw, thread.persistence.baseDir));
    if (!def) {
      children.push(xmlElement("status", {}, [xmlText("no-window-export")]));
      return children;
    }
    if (typeof def.renderXml === "function") {
      const objChildren = await def.renderXml(ctx);
      if (Array.isArray(objChildren)) {
        children.push(...objChildren);
      }
      return children;
    }
    // 没有 renderXml — 用 title/description 兜底
    if (def.title) {
      children.push(xmlElement("custom_title", {}, [xmlText(def.title)]));
    }
    if (def.description) {
      children.push(xmlElement("description", {}, [xmlText(def.description)]));
    }
    return children;
  } catch (e) {
    children.push(xmlElement("error", {}, [xmlText((e as Error).message)]));
    return children;
  }
}

/** custom window 的 onClose dispatcher。 */
function onCloseCustomWindow(ctx: OnCloseContext): boolean | void {
  // dispatcher 不能 await；如果 ObjectWindowDefinition.onClose 是异步语义，
  // 这里 fire-and-forget 后默认放行；同步语义则返回 true/false。
  // 当前 ObjectWindowDefinition.onClose 的形态是 sync (boolean | void)，但要拿到 def 需 async。
  // 折衷：默认放行；Object 想自定义关闭副作用，改写 onClose hook 是 visible 维度未来扩展。
  return true;
}

registerObjectType("custom", {
  commands: customCommandsDispatcher,
  renderXml: renderCustomWindow,
  onClose: onCloseCustomWindow,
  basicKnowledge: `
custom window 表示一个 OOC Object 出现在 context 中。objectId 标识是哪个 Object。
每个 peer/children Object 会自动派生一个 custom window 进入 context(2026-05-28 ooc-6 Phase 6)。

内置命令:
- edit_relation: 更新 self 对该 peer 的 relation 文件。scope='session' 写 flows/,scope='long_term' 派 super flow 写 pools/。
  用法: open(parent_window_id="<peer_window_id>", command="edit_relation", args={ content: "...", scope: "session" | "long_term" })

Object 自定义命令通过该 Object 的 server/index.ts export const window.commands 注册。
`.trim(),
});
