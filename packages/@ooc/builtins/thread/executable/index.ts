/**
 * thread —— executable 维度。
 *
 * thread 是 agent 一次智能运行的载体（设计权威：thinkable `knowledge/thread.md`）。agency `talk`
 * 把它造出来（无 construct——thread 不经构造路径，裁决已定），thread 在它之上跑 thinkloop。
 *
 * thread 经 class 链继承 talk（`ooc.class: "talk"`）的全部会话 method：say / wait / close / share /
 * talk(构造) 都从 talk 继承（resolveMethod 走 class 链），故本类 `methods` **留空**。
 *
 * deferred（Wave4 talk 迁移归位）：say 的方法体仍是 thread 的行为（设计权威 thread.md 核心 3：
 * thread 持 inbox/outbox，say 据会话窗形态分流——fork 子窗走内存树派送、peer 窗走磁盘 talk-delivery）。
 * 该逻辑现深依赖 core 的 talk 渲染/delivery（旧渲染上下文签名，本轮未迁），故暂不落在本 class 的
 * executable methods 上；talk 迁到新契约后把 say 归位到 thread.executable。
 */
import type { ExecutableModule } from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

const executable: ExecutableModule<Data> = {
  methods: [],
};

export default executable;
