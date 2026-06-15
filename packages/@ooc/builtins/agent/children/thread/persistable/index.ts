/**
 * thread —— persistable 维度（声明 **inline 持久化**）。
 *
 * thread 是 agent 运行过程的载体、也是所属 thread 自己的运行态自有窗（会话窗 self/peer/fork/
 * reflect_request 投影都是 thread 实例）。它经 `mode:"inline"` 声明：整窗随该 thread 的
 * `thread-context.json` inline 落盘、不写独立 `state.json`。
 *
 * 薄壳委托底座：inline 的实际落盘由 core 的 thread-context 底座（thread-json /
 * flow-thread-context）代劳——thread 的运行态（context / inbox / outbox / events / status）
 * 持久化机制属 persistable 维度底座、集中在 `core/persistable/`，本模块只**声明策略**，
 * 故无 save / load（取代旧的 registry `isBuiltinFeature` 硬编码标志）。
 */
import type { PersistableModule } from "@ooc/core/persistable/contract.js";
import type { Data } from "../types.js";

const persistable: PersistableModule<Data> = { mode: "inline" };

export default persistable;
