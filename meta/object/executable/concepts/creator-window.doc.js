import * as init from "@src/executable/windows/init";

/**
 * Creator window 概念：每个 thread 启动时必有一条与创建方的恒在通道。
 *
 * sources:
 *  - init — initContextWindows 与 isCreatorSelf / isUserRootThread 等派生规则
 */
export const creator_window_v20260515_1 = {
  name: "CreatorWindow",
  description: `
每个 thread 启动时必有一条与创建方的恒在通道，称为 creator window，由 initContextWindows
注入。该 window 的 type 由 thread.creatorObjectId vs thread.persistence.objectId 决定：

- 同 object（含两者都缺省）→ "do" 类型（同 object 内 fork 的子线程；creator 是父 thread）
- 不同 object → "talk" 类型（跨对象 talk 派生的 callee thread；creator 是 caller object 的某个 thread；
  callee 通过该 talk_window.say 回复给 caller）

特殊：user.root 是整个 session 的交互起点，没有 "creator"，所以也不应该有初始 creator window。
isUserRootThread short-circuit 这种 thread。

creator window 的 isCreatorWindow=true 标志使它不可被 LLM 主动 close（onClose hook 拒绝），
保证与 caller 的通道始终在场。
`.trim(),
  sources: { init },
};
