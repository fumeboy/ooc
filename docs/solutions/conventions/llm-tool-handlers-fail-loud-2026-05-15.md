---
title: LLM tool handlers must fail loudly on malformed input
date: 2026-05-15
category: conventions
module: src/executable/tools
problem_type: convention
component: tooling
severity: high
applies_when:
  - Implementing or modifying any LLM-callable tool handler in src/executable/tools/
  - Adding a new field to an existing tool's input schema
  - Reviewing why an agent keeps repeating the same wrong tool call
tags: [llm-control-plane, tool-design, agent-feedback, fail-loud, refine]
---

# LLM tool handlers must fail loudly on malformed input

## Context

Tool handlers in `src/executable/tools/` define the contract between the LLM agent and the OOC runtime. The LLM has no compiler — its only feedback signal is the JSON response from each tool call. When a handler accepts a malformed call without complaint, the agent receives **misleading positive reinforcement**: it learns to repeat the same wrong shape, and downstream side effects fail later in opaque ways.

We hit this twice in one session over different forms of the same anti-pattern in `refine`:

1. **Schema/protocol naming drift** — the schema field was `form_args`, but every doc and tool description said `args`. The LLM dutifully sent `args`. The handler read `form_args` (undefined) and returned `{ ok: true, message: "已累积参数。当前路径：say。" }`. Eventual `submit` failed with "缺少 msg".
2. **Empty `args` accepted as success** — even after fixing the naming, when the LLM sent `refine(form_id)` with no args field, the handler treated it as a no-op refine and returned the same success message. The LLM, seeing "已累积参数", confidently submitted; submit failed identically.

In both cases the bug was the same: the control plane silently rewarded malformed input. Fixing the schema was necessary but insufficient — we also had to make the handler reject empty/missing payloads explicitly.

## Guidance

LLM-facing tool handlers must observe these rules:

1. **Single name everywhere.** The schema field name, the handler's accessor, the tool description, and every reference in protocol KNOWLEDGE / examples must use the *same name*. If you rename, sweep all four. Maintain backward-compat by reading the legacy key as a fallback (`args.args ?? args.form_args`), not by keeping two names in the surface.

2. **Validate semantics, not just presence.** Schema `required` is enforced upstream by the model provider (OpenAI/Vertex), and they routinely let the model omit "required" fields. The handler must re-check what matters:
   - Required field missing → return error.
   - Required field present but semantically empty (`{}`, `""`, empty array) → return error if no-op is meaningless.

3. **Error messages must be actionable.** Tell the agent (a) what's wrong, (b) what the correct shape looks like, (c) the alternative if it didn't actually need this call. Example:

   ```
   refine 缺少 args 字段（业务参数对象）。空 refine 没有意义；
   请显式传入要累积的键值对，如 refine(form_id, args={ msg: "..." })。
   如果当前不需要再累积参数，应直接 submit(form_id)。
   ```

   That single error string makes the next round self-correcting. A bare `"missing args"` does not.

4. **Never silently no-op.** If the handler decides nothing happened, return an error, not `{ ok: true }`. The success channel is the agent's reinforcement signal — guard it.

## Why This Matters

The cost asymmetry is steep:

- A wrong tool description / silent-accept handler combo can burn an entire thinkloop session. The agent loops `open → refine → submit → fail → close → open → …` until it hits `wait`, leaves the conversation in `waiting` with zero outbox messages, and the user sees no reply at all. We watched this happen across three consecutive thread runs (`t_user_mp6mlf8y_*`, `t_user_mp6nwfvi_*`, `t_user_mp6ogqmx_*`) before realizing what was happening.
- The fix takes minutes — schema rename + 4 lines of validation — but only if you know the failure mode.
- Documentation drift is invisible until the agent runs into it. There is no compiler error for "your tool description says X but your schema says Y".

The deeper principle: **for an LLM, the tool's response *is* the documentation for next time.** Treat it as such.

## When to Apply

- Whenever you add a new tool to `src/executable/tools/`.
- Whenever you rename a field in a tool's input schema (sweep description, protocol KNOWLEDGE, examples in `meta/`, tests).
- Whenever a thread.json shows the agent repeatedly calling the same tool in a way that looks "almost right" — that's the smell.
- During PR review of any handler change: ask "what does this return when the agent omits the payload?"

## Examples

### Before — silent accept

```ts
// src/executable/tools/refine.ts (old)
export async function handleRefineTool(thread, args) {
  const formId = args.form_id;
  if (!formId) return errorOutput("refine 缺少 form_id 参数。");
  const incoming = (args.form_args as Record<string, unknown>) ?? {};
  // ↑ schema says form_args, but docs/protocol all say args.
  // LLM sends args; handler reads form_args; incoming = {}; refine no-ops; ok.
  const ok = mgr.refine(formId, incoming);
  return successOutput(`[refine] Form ${formId} 已累积参数。当前路径：${paths}。`);
}
```

### After — names aligned + semantic validation + actionable error

```ts
// src/executable/tools/refine.ts (current)
export async function handleRefineTool(thread, args) {
  const formId = args.form_id;
  if (!formId) return errorOutput("refine 缺少 form_id 参数。");
  // Read new key; fall back to legacy key for backward compat.
  const incomingRaw = (args.args ?? args.form_args) as Record<string, unknown> | undefined;
  if (!incomingRaw || typeof incomingRaw !== "object" || Array.isArray(incomingRaw)) {
    return errorOutput(
      "refine 缺少 args 字段（业务参数对象）。空 refine 没有意义；" +
      "请显式传入要累积的键值对，如 refine(form_id, args={ msg: \"...\" })。" +
      "如果当前不需要再累积参数，应直接 submit(form_id)。",
    );
  }
  if (Object.keys(incomingRaw).length === 0) {
    return errorOutput("refine 收到空 args（{}）。空 refine 没有意义；请填上至少一个要累积的键值对，或直接 submit(form_id)。");
  }
  // ... actual refine
}
```

The schema's `args` field name now matches every doc, the handler rejects both missing and empty payloads, and the error itself teaches the agent what to do next.

## Related

- `src/executable/tools/refine.ts` — the handler this rule was extracted from
- `src/executable/index.ts` `KNOWLEDGE` — protocol text the LLM reads each round; keep tool examples here in sync with handler schemas
- `src/executable/windows/talk.ts` `SAY_KNOWLEDGE` — example of per-command knowledge embedding the recommended one-shot vs three-step usage
