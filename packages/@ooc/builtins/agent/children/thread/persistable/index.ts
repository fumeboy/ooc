/**
 * thread —— persistable 维度。
 *
 * thread 是 builtin object，它的持久化**逻辑全在自己这里**，走 object-model 标准契约
 * `save` / `load`（与 `builtins/example/persistable/index.ts` 同一套），**不再**有专属 `container`：
 * - `mode:"inline"`：thread **作为别的 context 里的一个窗**时，整窗随所属 thread 的
 *   `thread-context.json` inline 落盘、不写独立 data.json（会话窗 self/peer/fork/reflect_request
 *   投影都是 thread 实例）。
 * - `save` / `load`（`saveThread`/`loadThread`，实现在 `./thread-persist`）：thread **作为运行会话容器**
 *   时的持久化（thread.json + thread-context.json + inbox + hydrate）。这是 thread 容器持久化的**唯一**
 *   逻辑入口；文件原语在本 builtin（`./thread-json` 的 `threadFile`、`./flow-thread-context`、`./inbox-store`）。
 *
 *   **core 经 seam 派发、不具名 import 本实现**（thread 去特权化，见
 *   `docs/issues/2026-06-23-thread-deprivileging.md` P1）：core/app 引擎落盘/读回一条 thread 容器时调
 *   `core/persistable/thread-container-io.ts` 的 `writeThread`/`readThread`——它经
 *   `resolvePersistable(THREAD_CLASS_ID).save/load` 派发到本 `save`/`load`（**thread 自主持久化**：序列化
 *   逻辑归 thread、core 只触发；object-model 核心 7 = 持久化经 seam 自定义）。本 builtin 不再导出
 *   `writeThread`/`readThread` adapter。
 */
import type { PersistableModule } from "@ooc/core/persistable/contract.js";
import { saveThread, loadThread } from "./thread-persist.js";

// 注：模块不带窗 Data 泛型——thread 的两角色（运行容器 vs 别人 context 里的会话窗）落盘形态不同：
// save/load 操作**整份会话 blob**（ThreadContext，强类型在 saveThread/loadThread 内），而 readable/
// executable 的窗 Data 是 per-conversation TalkData。OocClass<Data> 的 persistable 泛型只能取其一，
// 故此处用 PersistableModule（Data=any）解耦，由 save/load 函数各自收窄。
const persistable: PersistableModule = {
  mode: "inline",
  save: saveThread,
  load: loadThread,
};

export default persistable;
