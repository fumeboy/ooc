/**
 * thread —— persistable 维度。
 *
 * thread 是 builtin object，它的持久化**逻辑全在自己这里**，走 object-model 标准契约
 * `save` / `load`（与 `builtins/example/persistable/index.ts` 同一套）。
 *
 * - `mode:"inline"`：thread **作为别的 context 里的一个窗**时，整窗随所属 context inline 落盘、
 *   不写独立 data.json（会话窗 self/peer/fork/super 投影都是 thread 实例）。
 * - `save` / `load`：thread **作为运行会话容器**时的持久化——把整份 ThreadContext 序列化成
 *   单个 `<dir>/thread.json`（`dir` 由 PersistableContext 给出，core 已解析到该 thread 的目录）。
 *   core 经 seam（`resolvePersistable(THREAD_CLASS_ID).save/load`）派发到此，不具名 import 本实现。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PersistableContext,
  PersistableModule,
} from "@ooc/core/types/persistable.js";
import { toJson } from "@ooc/core/persistable/common.js";
import type { ThreadContext } from "@ooc/builtins/agent/children/thread/types.js";

/** 单个 thread 的 `thread.json` 绝对路径。 */
function threadFile(dir: string): string {
  return join(dir, "thread.json");
}

async function save(ctx: PersistableContext, thread: ThreadContext): Promise<void> {
  await mkdir(ctx.dir, { recursive: true });
  await writeFile(threadFile(ctx.dir), toJson(thread), "utf8");
}

async function load(ctx: PersistableContext): Promise<ThreadContext | undefined> {
  let raw: string;
  try {
    raw = await readFile(threadFile(ctx.dir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return JSON.parse(raw) as ThreadContext;
}

// 注：模块不带窗 Data 泛型——thread 的两角色（运行容器 vs 别人 context 里的会话窗）落盘形态不同：
// save/load 操作**整份会话 blob**（ThreadContext），而 readable/executable 的窗 Data 是 per-conversation
// TalkData。OocClass<Data> 的 persistable 泛型只能取其一，故此处用 PersistableModule（Data=any）解耦。
const persistable: PersistableModule = {
  save,
  load,
};

export default persistable;
