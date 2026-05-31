/**
 * root todo_* methods —— B 类 todo 塌缩后的 owner-scoped 待办操作（OOC-4 L5a）。
 *
 * 不再创建 todo_window（已删）；改为读写对象级 `todos.json`（flow object 文件）：
 * - todo_add(content, on_command_path?)：append 一条未完成待办。
 * - todo_check(id) / todo_uncheck(id)：切换 done。
 * - todo_remove(id)：删除一条。
 * - todo_list：返回当前所有待办（method 返回值给 LLM；未完成 todos 亦由自视切片常驻渲染）。
 *
 * 落盘载体 = src/persistable/flow-todos.ts；写经 enqueueSessionWrite 串行化。
 * todos 属对象（object-scoped）：该对象所有 thread 的自视都渲染同一份（spec L5-6 §4）。
 *
 * nil-persistence（无 ctx.thread.persistence，纯内存测试模式）：无文件路径，
 * method 不落盘、返回一条说明文本（不抛错）。
 */

import type {
  MethodExecutionContext,
  MethodKnowledgeEntries,
  MethodEntry,
  MethodExecOutcome,
} from "../_shared/method-types.js";
import type { FlowObjectRef } from "../../../persistable/common.js";
import { mutateTodos, readTodos, type Todo } from "../../../persistable/index.js";

const TODO_ADD_BASIC_PATH = "internal/executable/todo_add/basic";
const TODO_ADD_INPUT_PATH = "internal/executable/todo_add/input";
const TODO_CHECK_BASIC_PATH = "internal/executable/todo_check/basic";
const TODO_UNCHECK_BASIC_PATH = "internal/executable/todo_uncheck/basic";
const TODO_REMOVE_BASIC_PATH = "internal/executable/todo_remove/basic";
const TODO_LIST_BASIC_PATH = "internal/executable/todo_list/basic";

const TODO_ADD_KNOWLEDGE = `
todo_add 登记一条对象级待办（写入 todos.json）。未完成待办每轮在 <self_view><todos> 自视切片中常驻可见。

参数：
- content: 必填，待办内容
- on_command_path: 可选，命中这些 command path 时强提醒（数组，自视里标注）

示例：
exec(method="todo_add", title="补集成测试", args={ content: "补 program shell 集成测试", on_command_path: ["program.shell"] })

提示：
- todos 属对象，不属单个 thread；同对象的子线程自视也会看到。
- 完成后用 exec(method="todo_check", args={ id: "<todo_id>" })；撤销用 todo_remove。
`.trim();

const TODO_CHECK_KNOWLEDGE = `
todo_check 把一条待办标记为完成（done=true）；完成后不再出现在自视切片里。
参数：id（必填，todo_add 返回或 todo_list 列出的 id）。
示例：exec(method="todo_check", args={ id: "<todo_id>" })
`.trim();

const TODO_UNCHECK_KNOWLEDGE = `
todo_uncheck 把一条已完成待办改回未完成（done=false）；改回后会重新出现在自视切片里。
参数：id（必填）。
示例：exec(method="todo_uncheck", args={ id: "<todo_id>" })
`.trim();

const TODO_REMOVE_KNOWLEDGE = `
todo_remove 永久删除一条待办（无论是否完成）。
参数：id（必填）。
示例：exec(method="todo_remove", args={ id: "<todo_id>" })
`.trim();

const TODO_LIST_KNOWLEDGE = `
todo_list 返回当前对象的全部待办（含已完成），供查看全貌。
未完成的待办本就常驻于 <self_view><todos> 自视切片，无需 list 也能看到。
示例：exec(method="todo_list", args={})
`.trim();

export enum TodoCommandPath {
  Add = "todo_add",
  AddOnCommandPath = "todo_add.on_command_path",
  Check = "todo_check",
  Uncheck = "todo_uncheck",
  Remove = "todo_remove",
  List = "todo_list",
}

// ─────────────────────────── helpers ──────────────────────────────────────────

/** 从 thread.persistence 派生对象级 FlowObjectRef（threadId 字段被 objectDir 忽略，无害）。 */
function flowRefOf(ctx: MethodExecutionContext): FlowObjectRef | undefined {
  const ref = ctx.thread?.persistence;
  if (!ref?.objectId) return undefined;
  return { baseDir: ref.baseDir, sessionId: ref.sessionId, objectId: ref.objectId, stonesBranch: ref.stonesBranch };
}

function genTodoId(): string {
  return `td_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const NIL_PERSISTENCE_NOTE =
  "[todo] 当前 thread 无持久化目录（内存模式），todos.json 不落盘；本次操作未持久化。";

/** 把一条 todo 渲染成单行文本（todo_list / 反馈用）。 */
function formatTodo(t: Todo): string {
  const box = t.done ? "[x]" : "[ ]";
  const onPath = t.onCommandPath && t.onCommandPath.length > 0 ? ` (on: ${t.onCommandPath.join(", ")})` : "";
  return `${box} ${t.id}: ${t.content}${onPath}`;
}

// ─────────────────────────── todo_add ──────────────────────────────────────────

export const todoAddCommand: MethodEntry = {
  paths: [TodoCommandPath.Add, TodoCommandPath.AddOnCommandPath],
  match: (args) => {
    const hit: string[] = [TodoCommandPath.Add];
    if (Array.isArray(args.on_command_path) && args.on_command_path.length > 0) {
      hit.push(TodoCommandPath.AddOnCommandPath);
    }
    return hit;
  },
  knowledge: (args, formStatus): MethodKnowledgeEntries => {
    const entries: MethodKnowledgeEntries = { [TODO_ADD_BASIC_PATH]: TODO_ADD_KNOWLEDGE };
    if (formStatus !== "open") return entries;
    if (typeof args.content !== "string" || args.content.trim().length === 0) {
      entries[TODO_ADD_INPUT_PATH] =
        "todo_add 还缺以下参数: content。\n" +
        "请用 refine(form_id, args={ content: \"<待办内容>\", on_command_path?: [\"<cmd>\"] }) 补齐后 submit(form_id)。\n" +
        "不要 close 重 open——form 当前在 open 状态, refine 是正确路径。";
    }
    return entries;
  },
  exec: (ctx) => executeTodoAdd(ctx),
};

export async function executeTodoAdd(ctx: MethodExecutionContext): Promise<MethodExecOutcome> {
  const content = typeof ctx.args.content === "string" ? ctx.args.content.trim() : "";
  if (!content) {
    return {
      ok: false,
      error:
        "[todo_add] 缺少 content 参数。form 已 submit 失败 (status=failed)。**可以 refine 修正参数后重 submit**（推荐）: refine(form_id, args={ content: \"<待办内容>\", on_command_path: [\"<cmd>\"] }) 会自动把 form 切回 open, 再 submit; 或 close(form_id) 彻底放弃这次调用。",
    };
  }
  const onCommandPath = Array.isArray(ctx.args.on_command_path)
    ? (ctx.args.on_command_path as unknown[]).filter((v): v is string => typeof v === "string")
    : undefined;
  const todo: Todo = {
    id: genTodoId(),
    content,
    done: false,
    ...(onCommandPath && onCommandPath.length > 0 ? { onCommandPath } : {}),
  };

  const ref = flowRefOf(ctx);
  if (!ref) return { ok: true, result: `${NIL_PERSISTENCE_NOTE} (拟新增: ${formatTodo(todo)})` };
  await mutateTodos(ref, (todos) => [...todos, todo]);
  return { ok: true, result: `已登记待办 ${todo.id}：${content}` };
}

// ─────────────────────────── todo_check / todo_uncheck ─────────────────────────

function makeSetDoneCommand(opts: {
  name: string;
  basicPath: string;
  knowledge: string;
  done: boolean;
}): MethodEntry {
  return {
    paths: [opts.name],
    match: () => [opts.name],
    knowledge: (): MethodKnowledgeEntries => ({ [opts.basicPath]: opts.knowledge }),
    exec: (ctx) => executeSetDone(ctx, opts.name, opts.done),
  };
}

async function executeSetDone(
  ctx: MethodExecutionContext,
  name: string,
  done: boolean,
): Promise<MethodExecOutcome> {
  const id = typeof ctx.args.id === "string" ? ctx.args.id.trim() : "";
  if (!id) {
    return {
      ok: false,
      error: `[${name}] 缺少 id 参数。refine(form_id, args={ id: "<todo_id>" }) 补齐后 submit；或 close(form_id) 放弃。`,
    };
  }
  const ref = flowRefOf(ctx);
  if (!ref) return { ok: true, result: NIL_PERSISTENCE_NOTE };
  let found = false;
  await mutateTodos(ref, (todos) =>
    todos.map((t) => {
      if (t.id !== id) return t;
      found = true;
      return { ...t, done };
    }),
  );
  if (!found) {
    return { ok: false, error: `[${name}] 未找到 id="${id}" 的待办；用 todo_list 查看当前 id。` };
  }
  return { ok: true, result: `待办 ${id} 已标记 done=${done}。` };
}

export const todoCheckCommand: MethodEntry = makeSetDoneCommand({
  name: TodoCommandPath.Check,
  basicPath: TODO_CHECK_BASIC_PATH,
  knowledge: TODO_CHECK_KNOWLEDGE,
  done: true,
});

export const todoUncheckCommand: MethodEntry = makeSetDoneCommand({
  name: TodoCommandPath.Uncheck,
  basicPath: TODO_UNCHECK_BASIC_PATH,
  knowledge: TODO_UNCHECK_KNOWLEDGE,
  done: false,
});

// ─────────────────────────── todo_remove ───────────────────────────────────────

export const todoRemoveCommand: MethodEntry = {
  paths: [TodoCommandPath.Remove],
  match: () => [TodoCommandPath.Remove],
  knowledge: (): MethodKnowledgeEntries => ({ [TODO_REMOVE_BASIC_PATH]: TODO_REMOVE_KNOWLEDGE }),
  exec: (ctx) => executeTodoRemove(ctx),
};

export async function executeTodoRemove(ctx: MethodExecutionContext): Promise<MethodExecOutcome> {
  const id = typeof ctx.args.id === "string" ? ctx.args.id.trim() : "";
  if (!id) {
    return {
      ok: false,
      error: "[todo_remove] 缺少 id 参数。refine(form_id, args={ id: \"<todo_id>\" }) 补齐后 submit；或 close(form_id) 放弃。",
    };
  }
  const ref = flowRefOf(ctx);
  if (!ref) return { ok: true, result: NIL_PERSISTENCE_NOTE };
  let removed = false;
  await mutateTodos(ref, (todos) =>
    todos.filter((t) => {
      if (t.id === id) {
        removed = true;
        return false;
      }
      return true;
    }),
  );
  if (!removed) {
    return { ok: false, error: `[todo_remove] 未找到 id="${id}" 的待办；用 todo_list 查看当前 id。` };
  }
  return { ok: true, result: `待办 ${id} 已删除。` };
}

// ─────────────────────────── todo_list ─────────────────────────────────────────

export const todoListCommand: MethodEntry = {
  paths: [TodoCommandPath.List],
  match: () => [TodoCommandPath.List],
  knowledge: (): MethodKnowledgeEntries => ({ [TODO_LIST_BASIC_PATH]: TODO_LIST_KNOWLEDGE }),
  exec: (ctx) => executeTodoList(ctx),
};

export async function executeTodoList(ctx: MethodExecutionContext): Promise<MethodExecOutcome> {
  const ref = flowRefOf(ctx);
  if (!ref) return { ok: true, result: `${NIL_PERSISTENCE_NOTE} 当前列表为空。` };
  const todos = await readTodos(ref);
  if (todos.length === 0) return { ok: true, result: "当前没有待办。" };
  return { ok: true, result: todos.map(formatTodo).join("\n") };
}
