# thinkable/context

This directory owns the path from "what a thread can see" to "what the LLM receives".

```text
threads.json / thread.json / stone / traits / inbox / forms
        |
        v
builder.ts
        |
        |  ThreadContext
        v
messages.ts
        |
        |  Message[]
        v
LLM
```

## builder.ts

`builder.ts` answers: **what can this thread see right now?**

It reads thread-tree state, thread data, stone identity, active traits, memory, inbox, todos, directory entries, relations, build feedback, coverage feedback, open files, and other context windows. It then returns a structured `ThreadContext`.

The important boundary is that `builder.ts` does not decide LLM message roles and does not format the final prompt. It builds semantic data:

- `whoAmI`
- `instructions`
- `knowledge`
- `parentExpectation`
- `plan`
- `processEvents`
- `locals`
- `inbox`
- `todos`
- `directory`
- `relations`
- `childrenSummary`
- `ancestorSummary`
- `siblingSummary`
- `status`

So `builder.ts` is the context collection layer: it decides **what exists in the current world**.

## messages.ts

`messages.ts` answers: **how should this context be fed to the LLM?**

It takes the `ThreadContext` from `builder.ts` and turns it into `Message[]`.

The current layout is:

```ts
[
  { role: "system", content: "<context>...</context>" },
  { role: "user", content: "<process_event type=\"message_in\" ...>...</process_event>" },
  { role: "...", content: "<process_event ...>...</process_event>" },
  ...
]
```

The first message is a system message containing the `<context>` information window. It includes stable identity, instructions, knowledge, task state, inbox, active forms, directory, relations, paths, and status.

Unread inbox messages are also emitted as synthetic `message_in` user messages for the current LLM turn. The same messages remain visible inside `<context><inbox>...</inbox></context>` for state inspection, but the independent user message gives the model an explicit current input instead of leaving the request hidden inside system context only.

Historical `processEvents` are not embedded inside `<context>`. They are emitted as independent messages so the transcript can be trimmed, summarized, or replayed more precisely.

`messages.ts` also classifies process events:

- `llm_interaction`: LLM-facing interaction events such as `text`, `tool_use`, `message_in`, and `message_out`.
- `context_change`: state-change events such as `inject`, `program`, `set_plan`, `create_thread`, and `thread_return`.

Historical `thinking` events are deliberately filtered out of LLM messages. They remain in persisted thread events and debug files for human inspection, but they are not fed back into the model.

## compact.ts

`compact.ts` contains pure helpers for estimating, marking, previewing, and applying compaction to process events. It does not build context and does not talk to the LLM directly.

## Naming

Thread history is called **process events** across the context layer, backend process projection, and frontend process views:

```text
process events = history of LLM interactions + context changes
```

When adding new context behavior:

- Add collection logic to `builder.ts` if the thread should see new information.
- Add encoding logic to `messages.ts` if the LLM input representation should change.
- Add compaction logic to `compact.ts` only when the historical event stream needs trimming or summarization behavior.
