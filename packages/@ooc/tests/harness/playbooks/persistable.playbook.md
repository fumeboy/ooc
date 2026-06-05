# persistable 体验官 Playbook

## 维度 brief
持久化：stone（长期身份/数据/能力/记忆）+ flow（会话运行态）+ thread.json 落盘可恢复；
self.md/server 改动经 stone-versioning 进 git；pool 跨 session 沉淀。
**外部可观察落点**：`stones/` git commit、`flows/.../thread-context.json` roundtrip、`pools/` 文件。
**注意**：偏基础设施，多从 fs/git 直接取证。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant"}`（真 server 已 ensureStoneRepo）。
2. 记下初始 `git -C <WORLD>/stones/main log --oneline`（应有 bootstrap commit）。

## 种子场景

### S1 versioned write 进 git
- **task**：「更新你的 self.md，在末尾加一句『我擅长时间序列分析』，保存。」
- **观察**：
  - `cat <WORLD>/stones/main/objects/assistant/self.md` → 含新增句
  - `git -C <WORLD>/stones/main log --oneline -- objects/assistant/self.md` → 出现一条**非 bootstrap** 的 commit（署名应含 assistant/self，非 "bootstrap"）
- **rubric**：
  - Good：self.md 含新句 + git 有 agent 署名的 commit
  - OK：self.md 改了但没进 git / commit 署名是 bootstrap
  - Bad：self.md 没改 / 报错

### S2 thread 持久化可恢复
- **task**：派任意单轮任务（「数到 3」）等 done
- **观察**：
  - `<WORLD>/flows/<sid>/...` 下有 `thread-context.json`（或等价 thread 落盘）
  - 结构含 contextWindows / events / status=done —— 即可从盘恢复
- **rubric**：Good=thread.json 落盘且结构完整可恢复；OK=落了但残缺；Bad=没落盘

### S3 pool 沉淀
- **观察**（建 stone 时已建 pool）：`ls <WORLD>/pools/assistant/` → knowledge/ 等目录存在（pool 层就绪供跨 session 沉淀）
- **rubric**：Good=pool 目录结构正确（pools/assistant/knowledge/）；OK=部分；Bad=没 pool

## 探索提示
- 改 self.md 两次，看 git 历史是否两条 commit（versioning 不丢历史）。
- 重启 server（编排外手动）后读同一 thread，验真能恢复（roundtrip）。

## 已知陷阱
- **marker = package.json**（含 ooc.kind=object），不是 .stone.json（ooc-6 起）。
- pool flat 布局 `pools/<id>/`，不是 `pools/objects/<id>/`。
- stone git：bare repo + worktree 在 stones/main/；commit 署名区分 bootstrap vs agent。
- 真实 server 自动 ensureStoneRepo（test 的 buildServer 不会）——这里用真 server 没问题。
