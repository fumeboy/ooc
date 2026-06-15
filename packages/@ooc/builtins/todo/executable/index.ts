/**
 * todo —— executable 维度（object method）。
 *
 * todo 是静态待办卡片，**没有 LLM 可调用的 object method**（旧实现里它只能被 close，
 * 而 close 是纯生命周期、无业务副作用——归 runtime 信封管理，不作 object method）。
 * 构造逻辑在 ../index.ts 的 `Class.construct`。故 methods 为空。
 */

import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [],
};

export default executable;
