/**
 * thread —— executable 维度。
 *
 * thread 是 agent 一次智能运行的载体（设计权威：thinkable `knowledge/thread.md`）。agency `talk`
 * 把它造出来（无 construct——thread 不经构造路径，裁决已定），thread 在它之上跑 thinkloop。
 *
 * thread 经 class 链继承 talk（`ooc.class: "talk"`）的全部会话能力：say / close / share（object
 * method）+ talk(construct) 从 talk 继承（resolveObjectMethod 走 class 链），wait 是 3 原语之一
 * （独立 tool 入口，非 method）。故本类 `methods` **留空**。
 *
 * Wave 4 talk 迁移已落定：say 的方法体（据会话窗形态分流——fork 子窗走内存树派送、peer 窗走磁盘
 * talk-delivery）现作为 talk 的 object method 落在 `core/executable/windows/talk/executable/index.ts`，
 * thread 经 class 链继承，无需在本类重复声明。
 */
import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [],
};

export default executable;
