# persistable 体验官 Playbook

## 维度 brief
持久化：stone（长期身份/数据/能力/记忆，**main 分支 = canonical**）+ flow（会话运行态）+
thread.json 落盘可恢复；pool 跨 session 沉淀。
**新模型（Stone/Flow Overlay，2026-06-05）**：业务 session 内对自己 self 文件的改动 → **session overlay
试验层**（`flows/<sid>/<objId>/overlay/`，不即时进 git，session 内 shadow 可见、main 不变）；
**正式生效须经 super flow `evolve_self` 合入 main**（建实验分支→应用→ff-merge）。
**外部可观察落点**：`flows/<sid>/<objId>/overlay/` 文件、`stones/main/objects/<id>/` canonical + git commit、
`flows/.../thread-context.json` roundtrip、`pools/` 文件。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant\n需要正式改身份时通过 super flow evolve_self 合入。"}`
2. 记初始 `git -C <WORLD>/stones/main log --oneline`（应有 bootstrap commit）+ `cat <WORLD>/stones/main/objects/assistant/self.md`。

## 种子场景

### S1 overlay 试验层（业务 session 改 self.md 不即时进 main）
- **task**：「更新你的 self.md，在末尾加一句『我擅长时间序列分析』。」（业务 session 内）
- **观察**：
  - `<WORLD>/flows/<sid>/assistant/overlay/self.md` → **存在且含新句**（落 overlay）
  - `<WORLD>/stones/main/objects/assistant/self.md` → **仍是原内容**（main 未变）
  - `git -C <WORLD>/stones/main log --oneline` → **无新 commit**（业务 session 不即时进 git）
  - agent 回复应体现「改动在 session 内试验，正式生效须 evolve_self」（引导生效）
- **rubric**：
  - Good：overlay/self.md 含新句 + main 未变 + git 无新 commit + agent 理解 overlay 语义
  - OK：overlay 落了但 agent 仍以为已永久改 / 或仍尝试裸 git
  - Bad：写到 main 即时 commit（旧行为未切）/ 报错 / 改动丢失

### S2 super flow evolve_self 合入 main
- **task 轮2**（`/continue` 或新 talk(target="super")）：「通过 super flow 把刚才的 self.md 改动正式合入。」
- **观察**（super flow 独立 job，须单独等）：
  - super flow 里调了 `evolve_self`
  - `<WORLD>/stones/main/objects/assistant/self.md` → **现在含新句**（已合入 main）
  - `git -C <WORLD>/stones/main log --oneline` → 出现一条**非 bootstrap、署名 assistant** 的 commit
- **rubric**：Good=evolve_self 合入后 main self.md 含新句 + git agent 署名 commit；OK=evolve_self 调了但 main 没更新/署名 bootstrap；Bad=evolve_self 不可用/报错/main 不变

### S3 thread 持久化 + pool
- **task**：派单轮任务（「数到 3」）等 done
- **观察**：`flows/<sid>/.../thread-context.json` 结构完整可恢复；`ls <WORLD>/pools/assistant/knowledge/` 目录就绪
- **rubric**：Good=thread.json 完整 + pool 结构正确；OK=部分；Bad=没落盘/没 pool

## 探索提示
- 在业务 session 改 self.md 后**不 evolve_self**，开新 session 读 self.md——应是 main 旧值（overlay 不跨 session）。
- evolve_self 后新 session 读 self.md——应是合入后的新值（身份演化生效）。

## 已知陷阱
- **新两层模型**：业务 session 写 self → overlay（不进 main）；evolve_self 才合 main。别再期望「业务 session 写 self.md 即进 git」（已是有意闸门）。
- **super flow 独立 job**：evolve_self 在 super session，须单独 poll 等其 done。
- canonical = `stones/main/objects/<id>/`（main worktree）；overlay = `flows/<sid>/<objId>/overlay/`。
- marker = package.json（非 .stone.json）；pool flat 布局 `pools/<id>/`。
- 控制面 HTTP putSelf/putServerSource 直写 main（外部权威）——与 agent in-session overlay 是两条通道。
