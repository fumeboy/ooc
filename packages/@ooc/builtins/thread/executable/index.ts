/**
 * thread —— executable 维度。
 *
 * thread 是 agent 一次智能运行的载体（设计权威：thinkable `knowledge/thread.md`）。agency `talk`
 * 把它造出来（无 constructor——thread 不经 open() 构造，裁决已定），thread 在它之上跑 thinkloop。
 *
 * - **say（S3.2 归位）**：say 是 thread 的行为（thread 持 inbox/outbox）。真正逻辑落在本类
 *   （executable/say.ts + method.say.ts）；会话窗 talk / reflect_request 的 say 共享同一 method
 *   （薄 delegation），LLM 仍在会话窗上 say，落到这同一份逻辑。
 * - **parentClass: null**：thread 不是 Agent（不继承 agency）、也不是 root 杂项窗，自成一类。
 * - **readable + flag**：配齐 readable hook 以过 boot 校验，并标记 renderableVisible /
 *   builtinReadable，与其它窗类型一视同仁。
 */
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { readable } from "../readable.js";
import { sayMethod } from "./method.say.js";

// thread 类的单处声明：executable（say）+ readable + 可见性 flag。无 constructor（由 agency talk 创建）。
builtinRegistry.registerWindowClass({
  type: "thread",
  parentClass: null,
  methods: {
    say: sayMethod,
  },
  readable,
  renderableVisible: true,
  builtinReadable: true,
});

export { sayMethod } from "./method.say.js";
