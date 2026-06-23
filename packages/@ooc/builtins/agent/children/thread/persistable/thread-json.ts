/**
 * thread.json 的 **path 原语**（thread builtin 自有）。
 *
 * thread 的容器持久化**逻辑**是 thread 自己的标准 `persistable.save`/`load`（`saveThread`/`loadThread`，
 * 见 `./thread-persist`）。core/app 引擎要落盘/读回一条 thread 时**经 registry seam 派发**
 * （`core/persistable/runtime-object-io.ts` 的 `saveObject`/`loadObject` → resolvePersistable →
 * 本 builtin 的 save/load），不再 import thread builtin 的具体函数（thread 去特权化，见
 * `docs/issues/2026-06-23-thread-deprivileging.md` P1）。本模块只剩供 save/load 内部用的 path 原语。
 */
import { join } from "node:path";
import { threadDir, type ThreadPersistenceRef } from "@ooc/core/persistable/common.js";

/** 单个线程的 `thread.json` 绝对路径（path 原语）。 */
export function threadFile(ref: ThreadPersistenceRef): string {
  return join(threadDir(ref), "thread.json");
}
