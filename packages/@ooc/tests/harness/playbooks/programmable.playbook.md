# programmable 体验官 Playbook

## 维度 brief
元编程：被测 Agent 用 `program(shell)` 给自己写 `server/index.ts` 方法库，再 `program(function)`/call_method 调用它——自我迭代潜力。
**外部可观察落点**：program window、`stones/main/objects/<self>/server/index.ts`、method 注册 + 调用结果、stone git。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant\n我能用 program 给自己写 server 方法并调用。"}`
2. 真实 server 开机已 ensureStoneRepo（stone git 就绪）。

## 种子场景

### S1 写并调用一个 self method
- **task**：「用 program 给自己写一个 server method 叫 `greet`，它返回字符串 `hello from assistant`，写好后调用它，把返回结果告诉我。」
- **观察**：
  - 读 thread → program window（shell 写文件 + function 调用）
  - `cat <WORLD>/stones/main/objects/assistant/server/index.ts` → 应含 `greet` 方法定义
  - assistant 回复是否含 `hello from assistant`（调用结果）
  - `git -C <WORLD>/stones/main log --oneline` → server/index.ts 改动可能进 git
- **rubric**：
  - Good：server/index.ts 含 greet + 调用返回 `hello from assistant` + assistant 回报结果
  - OK：方法写了但没成功调用 / 返回不符
  - Bad：program 失败 / 没写出文件 / 崩溃

### S2 method 持久可复用
- **观察**（接 S1）：`POST /api/flows/<sid>/<assistant>/call_method {method:"greet"}` 直接 HTTP 调用刚写的方法
- **rubric**：Good=HTTP call_method 返回 `hello from assistant`（方法已注册可复用）；OK=需重新 program 才可调；Bad=call_method 404/报错

## 探索提示
- 让它写一个**带参数**的 method 再调用，看参数透传是否正确。
- 让它写一个会抛错的 method，看错误是否被捕获回报（不崩 server）。

## 已知陷阱
- program 在 sandbox 跑（executable/program/），写入落 self stone 自治区。
- 等 program job done 再 cat server/index.ts。
- call_method 路由是 `/api/flows/:sid/:objectId/call_method`（无 objects/ 段，F3 后对齐前端）。
