/**
 * thread —— executable 维度（S3.1 立座）。
 *
 * thread 是 agent 一次智能运行的载体（设计权威：thinkable `knowledge/thread.md`）。本子步只
 * **立座**：经 registerWindowClass 注册 `thread` 这个 window class 骨架——
 *
 * - **无 constructor**：thread 不经 open() 构造，而由 agency `talk` 创建（裁决已定）；
 *   故 methods 暂空。thread 的行为（say / wait / end）留待后续子步从 talk/tools 迁入。
 * - **parentClass: null**：thread 不是 Agent（不继承 agency）、也不是 root 杂项窗，自成一类。
 * - **readable + flag**：配齐 readable hook 以过 boot 校验，并标记 renderableVisible /
 *   builtinReadable，与其它窗类型一视同仁。
 *
 * 纯 additive：注册一个新 window type，但本子步尚无代码产出 / 消费 ThreadWindow。
 */
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";
import { readable } from "../readable.js";

// thread 类的单处声明：executable（methods 暂空，无 constructor）+ readable + 可见性 flag。
builtinRegistry.registerWindowClass({
  type: "thread",
  parentClass: null,
  methods: {},
  readable,
  renderableVisible: true,
  builtinReadable: true,
});
