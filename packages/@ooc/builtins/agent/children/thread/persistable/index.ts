/**
 * thread —— persistable 维度。
 *
 * thread 是 builtin object，它的持久化**逻辑全在自己这里**，走 object-model 标准契约
 * `save` / `load`（与 `builtins/example/persistable/index.ts` 同一套），**不再**有专属 `container`：
 * - `mode:"inline"`：thread **作为别的 context 里的一个窗**时，整窗随所属 thread 的
 *   `thread-context.json` inline 落盘、不写独立 state.json（会话窗 self/peer/fork/reflect_request
 *   投影都是 thread 实例）。
 * - `save` / `load`：thread **作为运行会话容器**时的持久化（thread.json + thread-context.json +
 *   inbox + hydrate），实现在 `./thread-persist`。thread 的落盘 API（`writeThread`/`readThread` +
 *   thread.json/thread-context/inbox 文件原语）现在**全在本 builtin**（`./thread-json`、
 *   `./flow-thread-context`、`./inbox-store`）；core 不再持有 thread 序列化入口或 registry-dispatch
 *   壳——runtime 引擎直接 import 本 builtin 的 `writeThread`/`readThread`（object-model 核心 7）。
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
