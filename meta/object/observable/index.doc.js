import { object_v20260504_1 } from "@meta";
import { persistable_v20260504_1 } from "@meta/object/persistable/index.doc";
import { pause_v20260506_1 } from "@meta/object/observable/pause.doc";
import { debug_v20260506_1 } from "@meta/object/observable/debug.doc";
import { context_visibility_v20260506_1 } from "@meta/object/observable/context-visibility.doc";

export const observable_v20260504_1 = {
  parent: object_v20260504_1,
  index: `
Observable 描述 Object 如何被观察、被理解与被验证。

在 OOC 中，Object 的“思考过程”是可记录、可回放、可调试的。

可观察性来自两个来源：

- process events：线程里发生过什么（按时间线记录）
- effects：对象对外产生的副作用
    - 当前实现上，effects 主要体现在 events 中：
      - program 执行的 result / success
      - file_ops / http / git 等能力产生的痕迹（文件变更、输出、错误）

OOC 有两个与“观测/调试”直接相关的开关：pause 与 debug：

- pause：暂停执行（让线程进入 paused 状态），可人工介入后再 resume
- debug：持续写入每轮 LLM 的输入/输出/思考/元数据到 debug 文件，便于事后排查（不暂停执行）

两者独立：pause 会暂停但不要求写 debug；debug 会写文件但不暂停。

可观察对象（概念层）:

- thread tree：线程结构、节点状态、父子线程关系
- context：本轮 LLM 输入窗口（哪些信息被注入、哪些 thread 可见）
- tool calls：LLM 行动
- errors：失败原因、堆栈、可复现证据

Observable 的目标:
- 让“对象为什么这么做”可解释
- 让“对象做了什么”可追溯
- 让“对象是否真的完成”可验证

## 子文档

- [pause](./pause.doc.js)                  暂停/恢复：人工检查点
- [debug](./debug.doc.js)                  debug 文件：事后排查
`,
  persistable: persistable_v20260504_1,
  pause: pause_v20260506_1,
  debug: debug_v20260506_1,
  contextVisibility: context_visibility_v20260506_1,
};
