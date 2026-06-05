/**
 * Shared form-guidance helpers for builtin object methods.
 *
 * Batch B1 (2026-06-04): extracted from 19 byte-identical `guidanceWindows()`
 * copies + the repeated `onFormChange` guard boilerplate scattered across
 * builtins/{root,plan,file,knowledge,todo,program,search}/executable/.
 *
 * Two exports:
 * - `buildGuidanceWindows(form, entries)` — turn a `{ path: text }` map into
 *   form-bound <guidance> windows. Typed against `GuidanceWindow` (no casts).
 * - `makeBasicFormHandler(basicPath, knowledge)` — factory for the common
 *   "single static guidance entry" onFormChange handler (the plan/file/knowledge
 *   pattern with no per-arg input hints).
 *
 * Methods that need argument-validation hints keep a hand-written onFormChange
 * but call `buildGuidanceWindows` for the final assembly.
 */

// batch C 集成：helper 工作在 onFormChange/exec 契约层，用 _shared 的 base
// ContextWindow / GuidanceWindow（与 ObjectMethod 契约一致），不引 executable 的
// union 版——否则 base form 无法传入 union 参数。MethodExecWindow 仅用于内部 narrow。
import type {
  ContextWindow,
  GuidanceWindow,
} from "@ooc/core/_shared";
import type { MethodExecWindow } from "@ooc/core/extendable/_shared/types.js";
import type { FormChangeEvent } from "@ooc/core/thinkable/context/intent.js";

/** guidance summary 截断长度——超过则 slice 并加省略号。 */
const GUIDANCE_SUMMARY_MAX = 200;

/**
 * 把 `{ path: text }` 映射构造为一组挂在 form 下的 form-bound guidance windows。
 *
 * 每个 entry → 一个 `type:"guidance"` window：parentWindowId / boundFormId 指向
 * form，provenance.mechanism="form_bound"，relevance.score=0.8。
 *
 * 用 `GuidanceWindow` 直接构造（不再 `as ContextWindow` 强转）——返回 ContextWindow[]
 * 以匹配 onFormChange 的契约签名。
 */
export function buildGuidanceWindows(
  form: ContextWindow,
  entries: Record<string, string>,
): ContextWindow[] {
  // batch C 集成：onFormChange/exec 的 form 在零依赖层退化为 base ContextWindow；
  // guidance 只读 base `id` + 具体 form 的 `command`（仅作 provenance 标签），
  // 在此唯一处 narrow 回 MethodExecWindow（runtime 保证 form 即 method_exec form）。
  const sourceId = (form as MethodExecWindow).command;
  const out: GuidanceWindow[] = [];
  for (const [path, text] of Object.entries(entries)) {
    const safe = path.replace(/[^a-zA-Z0-9_]/g, "_");
    out.push({
      id: "guidance_" + form.id + "_" + safe,
      type: "guidance",
      parentWindowId: form.id,
      boundFormId: form.id,
      title: path,
      status: "open",
      createdAt: 0,
      relevance: { score: 0.8, signalCount: 1 },
      provenance: {
        kind: "derived",
        reason: { mechanism: "form_bound", sourceId },
        createdAt: 0,
        lastTouchedAt: 0,
      },
      content: text,
      summary: text.length > GUIDANCE_SUMMARY_MAX ? text.slice(0, GUIDANCE_SUMMARY_MAX) + "..." : text,
    });
  }
  return out;
}

/**
 * 构造一个"单条静态 guidance"的 onFormChange handler。
 *
 * 覆盖最常见的形态：form 关闭时不渲染 guidance，否则挂一条固定的 basic 知识。
 * 不做参数校验的 method（plan / file / knowledge / todo 的多数 method）适用。
 *
 * 需要按参数缺失给输入提示的 method 不要用这个工厂——它们保留手写 onFormChange，
 * 内部调用 `buildGuidanceWindows` 即可。
 */
export function makeBasicFormHandler(
  basicPath: string,
  knowledge: string,
): (change: FormChangeEvent, ctx: { form: ContextWindow }) => ContextWindow[] {
  return (change, { form }) => {
    if (change.kind === "status_changed" && change.to !== "open") return [];
    return buildGuidanceWindows(form, { [basicPath]: knowledge });
  };
}
