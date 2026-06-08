/**
 * Window enrichment utilities — extracted from synthesizer.collectExecutableKnowledgeEntries.
 *
 * Handles:
 * - effectiveVisibleType resolution (parentClass inheritance chain fallback)
 * - method_exec form enrichment (methodKnowledgePaths from onFormChange guidance)
 * - Form knowledge entry extraction (from onFormChange guidance windows)
 */
import type { ContextWindow, MethodExecWindow, GuidanceWindow } from "../../executable/windows/_shared/types.js";
import type { MethodKnowledgeEntries } from "../../executable/windows/_shared/method-types.js";
import type { ObjectRegistry } from "../../executable/windows/_shared/registry.js";
import { builtinRegistry } from "../../executable/windows/index.js";
import { ROOT_METHODS } from "@ooc/builtins/root";
import type { ThreadContext } from "./index.js";
import type { FormChangeEvent, Intent } from "./intent.js";

function samePaths(left: string[] | undefined, right: string[]): boolean {
  if (!left && right.length === 0) return true;
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function lookupFormEntry(
  form: MethodExecWindow,
  thread: ThreadContext,
  registry: ObjectRegistry,
): import("../../executable/windows/_shared/method-types.js").ObjectMethod | undefined {
  const parentId = form.parentWindowId;
  if (!parentId || parentId === "root") {
    return ROOT_METHODS[form.method];
  }
  const parent = (thread.contextWindows ?? []).find((w) => w.id === parentId);
  if (!parent) return undefined;
  return registry.lookupMethod(parent, form.method);
}

/**
 * Compute knowledge entries derived from a single method_exec form via onFormChange.
 * Title → key, content → value.
 */
export async function computeFormKnowledgeEntries(
  form: MethodExecWindow,
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<MethodKnowledgeEntries> {
  const entry = lookupFormEntry(form, thread, registry);
  if (!entry?.onFormChange) return {};

  const args = form.accumulatedArgs;
  const change: FormChangeEvent = {
    kind: "args_refined",
    added: Object.keys(args),
    removed: [],
    changed: [],
    args,
  };
  const defaultIntent: Intent = { name: form.method };
  const intents = [defaultIntent, ...entry.intent(args)];
  const guidance = entry.onFormChange(change, { form, intents }) ?? [];

  const entries: MethodKnowledgeEntries = {};
  for (const w of guidance) {
    if (w.type !== "guidance") continue;
    const gw = w as GuidanceWindow;
    if (gw.content.trim() !== "") {
      entries[gw.title] = gw.content;
    }
  }
  return entries;
}

/**
 * Update a method_exec form's methodKnowledgePaths to match current derived entries.
 * Returns the form (possibly a new object if keys changed).
 */
export async function enrichFormMethodKnowledge(
  form: MethodExecWindow,
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<MethodExecWindow> {
  const knowledgeEntries = await computeFormKnowledgeEntries(form, thread, registry);
  const methodKnowledgePaths = Object.keys(knowledgeEntries);
  if (samePaths(form.methodKnowledgePaths, methodKnowledgePaths)) {
    return form;
  }
  return { ...form, methodKnowledgePaths: methodKnowledgePaths };
}

/**
 * Enrich all context windows:
 * - Resolve effectiveVisibleType for every window (along parentClass chain)
 * - For method_exec forms: compute methodKnowledgePaths + derive knowledge entries
 * - Skip sharing-state forms (ref / lent_out) for knowledge derivation
 *
 * Returns { enrichedWindows, formKnowledgeEntries }.
 */
export async function enrichContextWindows(
  windows: ContextWindow[] | undefined,
  thread: ThreadContext,
  registry: ObjectRegistry = builtinRegistry,
): Promise<{
  enrichedWindows: ContextWindow[];
  formKnowledgeEntries: MethodKnowledgeEntries;
}> {
  const list = windows ?? [];
  const enriched: ContextWindow[] = [];
  const formKnowledgeEntries: MethodKnowledgeEntries = {};

  for (const window of list) {
    const effVis = registry.resolveEffectiveVisibleType(window.type as any);
    const withVis: ContextWindow = effVis && effVis !== window.type
      ? { ...window, effectiveVisibleType: effVis }
      : window;

    if (window.type !== "method_exec") {
      enriched.push(withVis);
      continue;
    }

    // Sharing state: skip knowledge derivation
    if (window.sharing) {
      enriched.push(withVis);
      continue;
    }

    const form = window as MethodExecWindow;
    const enrichedForm = await enrichFormMethodKnowledge(form, thread, registry);
    const finalForm: ContextWindow = effVis && effVis !== enrichedForm.type
      ? { ...enrichedForm, effectiveVisibleType: effVis } as ContextWindow
      : (enrichedForm as ContextWindow);
    enriched.push(finalForm);

    const entries = await computeFormKnowledgeEntries(enrichedForm, thread, registry);
    for (const [path, content] of Object.entries(entries)) {
      if (!(path in formKnowledgeEntries)) {
        formKnowledgeEntries[path] = content;
      }
    }
  }

  return { enrichedWindows: enriched, formKnowledgeEntries };
}
