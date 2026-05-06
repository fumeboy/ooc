import { collaborable_v20260504_1 } from "@meta/object/collaborable/index.doc";

export const role_v20260506_1 = {
    parent: collaborable_v20260504_1,
    index: `
Role 描述合作中的特殊主体。

大部分 Object 地位平等：都有 Stone、都能 talk、都能创建子线程。
但有些 Object 因为**合作中的位置**而拥有特殊身份——最典型的是 supervisor。

## 子文档

- [supervisor](./supervisor.doc.js) — 全局代理，Session 总协调者

## 为什么需要"特殊角色"

如果完全平等，谁接收用户的第一条消息？谁管理 Session 看板？谁判断任务整体完成？

需要一个"默认路由 + 总协调"的角色——supervisor。

## 设计原则

**特殊角色不是特殊机制**——它们仍然是普通的 Stone：
- 有自己的 readme.md / data.json / knowledge / server / client
- 通过普通 talk 与其他对象通信
- 用同样的 ThinkLoop 思考

只是：
- 系统某些默认路径指向它们（如 user 消息默认路由到 supervisor）
- 它们的 knowledge 中包含对应的"职责说明"
- 它们的 server 中暴露了一些"专属操作"（如看板读写）

换言之：特殊性写在数据里（readme + knowledge + server），不写在系统内核里。
要把 supervisor 改名 / 替换为另一个对象，主要是改路由配置即可。

## 为什么尽量少有特殊角色

每增加一个特殊角色，都是对"对象平等"原则的一次让步。

当前只有 supervisor 是强特殊。其他常用对象（filesystem / library 等）虽然功能重要，
但都是普通对象——没有系统级特权，只是被引用频繁。
`,
};
