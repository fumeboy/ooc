/**
 * skill_index —— executable 维度（object method）。
 *
 * skill_index 是完全派生的索引窗：**不注册任何 object method**（空表）。
 * 打开具体 SKILL.md 由 filesystem 的 open_file 完成（见 readable 的 hint）。
 */

import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [],
};

export default executable;
