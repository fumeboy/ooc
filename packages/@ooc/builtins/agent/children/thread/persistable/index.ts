/**
 * thread —— persistable 维度。
 *
 * thread 是 builtin object，它的持久化**逻辑全在自己这里**：
 * - `mode:"inline"`：thread **作为别的 context 里的一个窗**时，整窗随所属 thread 的
 *   `thread-context.json` inline 落盘、不写独立 state.json（会话窗 self/peer/fork/reflect_request
 *   投影都是 thread 实例）。
 * - `container`：thread **作为运行会话容器**时的持久化逻辑（thread.json + thread-context.json +
 *   inbox + hydrate）。core 只提供框架与 API（runtime 引擎 / 串行写 / 路径原语 / 默认 state.json IO
 *   / registry dispatch），经 `writeThread`/`readThread` 与 manager persist hook **委托**到这里，
 *   core 不内含 thread 序列化逻辑（object-model 核心 7）。
 */
import type { PersistableModule } from "@ooc/core/persistable/contract.js";
import type { Data } from "../types.js";
import { threadContainer } from "./thread-container.js";

const persistable: PersistableModule<Data> = {
  mode: "inline",
  container: threadContainer,
};

export default persistable;
