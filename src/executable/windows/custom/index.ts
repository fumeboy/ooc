/**
 * custom_window dispatcher —— plan §6.2 / D1。
 *
 * 注册一份固定 type=`"custom"` 的 WindowRegistry 契约；commands / renderXml /
 * onClose / basicKnowledge 全部在调用瞬间从 `ctx.window.objectId` 路由到对应
 * Object 的 `stones/<objectId>/executable/index.ts` 的 `export const window`
 * （ObjectWindowDefinition）。
 *
 * 关键约束（plan §8 风险 1）：
 *   commands dispatcher 在 entry.exec 包装层直接把 `self: ProgramSelf` 注入到
 *   ctx，使 manager.submit 不需要感知 custom type。
 */

import { registerWindowType, type OnCloseContext, type RenderContext } from "../_shared/registry.js";
import type { MethodEntry, MethodExecutionContext } from "../_shared/method-types.js";
import type { CustomWindow } from "../_shared/types.js";
import { loadObjectWindow } from "../../server/loader.js";
import { createProgramSelf } from "../../server/self.js";
import type { ProgramSelf } from "../../server/types.js";
import type { ObjectWindowDefinition } from "../../server/window-types.js";
import { xmlElement, xmlText, type XmlNode } from "../../../thinkable/context/xml.js";

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

/**
 * methods 字段是一个 Proxy 风格的"按需查"字典：每次 manager 拿一条 entry 时,
 * dispatcher lazy load ObjectWindowDefinition，把对应 entry.exec 包一层，注入 self。
 *
 * 由于 manager 当前直接 .methods[name] 取 entry，我们用一个 Proxy 让"取 entry"
 * 这一步触发同步路径不可行（loader 是 async）。退化方案：在 entry.exec 内部 await
 * loadObjectWindow 现取 commands —— manager.submit 已经是 async，不影响。
 *
 * 这意味着 commands 表本身只能是"已知 command 名 → wrapper entry"的映射；但 custom
 * window 上的具体 command 名是 Object 自定义的、动态的。WindowRegistry 当前的
 * `getOpenableCommands` 等 API 接受静态命令表。
 *
 * 折衷：实际"哪些命令可调用"由 LLM 通过 basicKnowledge 文本指引，从 form.method 名
 * 落到 manager.submit 取 entry 这条链路上重写为 dispatcher（见 manager submit /
 * lookupFormEntry 分支处理 type=custom）。
 */
const customCommandsDispatcher: Record<string, MethodEntry> = new Proxy({}, {
  get(_target, prop: string) {
    // manager / synthesizer / activator 拿任何字符串 key 时返回一个 dispatcher entry；
    // 实际不存在的 command 在 exec 内部抛错。
    if (typeof prop !== "string") return undefined;
    if (prop === "then") return undefined; // 防 await 误以为是 thenable

    const wrapper: MethodEntry = {
      paths: [prop],
      match: () => [prop],
      knowledge: (args, formStatus) => {
        // 同步取 knowledge 在这里只能给基础占位，详细 knowledge 由 synthesizer 异步路径补；
        // 留个钩子表示"这条 command 来自 custom window"。
        return { [`internal/windows/custom/${prop}/basic`]: `custom command "${prop}"` };
      },
      exec: async (ctx: MethodExecutionContext) => {
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
        const entry = def.methods?.[prop];
        if (!entry) {
          const avail = Object.keys(def.methods ?? {}).join(", ") || "(无)";
          return `[custom.${prop}] 不存在；当前可用：${avail}`;
        }
        const self: ProgramSelf = createProgramSelf(stoneRef, thread);
        return await entry.exec({ ...ctx, self } as MethodExecutionContext);
      },
    };
    return wrapper;
  },
  has(_target, prop: string) {
    return typeof prop === "string";
  },
  ownKeys() {
    return [];
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

registerWindowType("custom", {
  methods: customCommandsDispatcher,
  renderXml: renderCustomWindow,
  onClose: onCloseCustomWindow,
});
