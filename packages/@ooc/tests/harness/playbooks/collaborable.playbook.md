# collaborable 体验官 Playbook

## 维度 brief
协作能力：跨对象 talk（一个 Object 通过 talk_window 给另一个 Object 派活），callee→caller 经 talks.json 反向路由回报。
**外部可观察落点**：多个 object 的 thread、talk_window 投递、`<WORLD>/flows/.../talks.json`、双方 outbox/inbox 双写。

## 驱动准备
1. 建两个 agent：
   - `POST /api/stones {objectId:"assistant", self:"# Assistant\n需要专业知识时找 expert 协作。"}`
   - `POST /api/stones {objectId:"expert", self:"# Expert\n我是领域专家，回答被咨询的问题。"}`
2. seed session 时 targetObjectId="assistant"。

## 种子场景

### S1 主动发起跨对象 talk
- **task**：「你不确定时，去咨询 expert：问它『UTC 时间戳该用什么格式存储』，把 expert 的答复转告我。」
- **观察**：
  - `GET /api/flows/<sid>/threads` → 应出现 expert 的 callee thread
  - 读 assistant thread 的 talk_window（target=expert）；读 expert thread 的 inbox（收到提问）+ outbox（回报）
  - `<WORLD>/flows/<sid>/.../talks.json` 反向路由记录
- **rubric**：
  - Good：expert thread 被创建并 done + expert 收到提问并回复 + assistant 把 expert 答复转告 user
  - OK：talk 发起了但回报没接上 / assistant 没转告
  - Bad：没发起 talk / expert thread 没建 / 崩溃

### S2 talk 双写一致
- **观察**（接 S1）：assistant.outbox 的去信 与 expert.inbox 的来信 是否同一 messageId；expert.outbox 回信 与 assistant.inbox 是否一致
- **rubric**：Good=双写 messageId 一致、无丢失；OK=送达但 id 对不上；Bad=单边丢失

## 探索提示
- 让 assistant 同时咨询两个 peer，看多 talk_window 并发是否串台。
- 让 expert 反过来再 talk 第三方，看多跳协作链是否成立。

## 已知陷阱
- talk window 后端已擦除（L6c-2，callee→caller 改 talks.json 反向路由）——观察回报看 talks.json + inbox，别找旧 talk window 落盘。
- expert 也要真 LLM 跑（独立 job），等它 done 再观察回报。
- creator talk_window 会在 callee 自动注入——区分主动发起的 talk_window 与 creator window。
