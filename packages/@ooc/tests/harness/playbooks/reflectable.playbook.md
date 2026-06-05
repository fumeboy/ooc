# reflectable 体验官 Playbook

## 维度 brief
反思沉淀：被测 Agent 走 super flow（talk target="super"）做自我反思，把经验沉淀为长期 memory，
必要时改 self.md 经 stone-versioning 进 git。**这是已验证达 Good 档的回归锚（= bun:test S5）**。
**外部可观察落点**：super 线程、`pools/<self>/knowledge/memory/<slug>.md`（flat 布局）+ frontmatter、stone git。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant\n需要沉淀长期经验时走 super flow（talk target=super）。"}`
2. seed 文件 `docs/note.md` 内容（一条独特约定，便于验 memory 是否真提到）：
   `- 时间戳：统一使用 UTC\n- 日志格式：JSON Lines`

## 种子场景

### S1 沉淀长期记忆（= S5 回归锚）
- **task 轮1**：「读 docs/note.md，告诉我这个项目对时间戳和日志格式有什么约定？」→ 等 done（~240s）
- **task 轮2**（`/continue`）：「请通过 super flow 把这条项目约定沉淀为你的一条长期记忆，方便下次想起。」
- **观察**（注意：super flow 是**独立 job**，须单独等其 done）：
  - `GET /api/flows/<sid>/threads` → 出现 super 反思线程并 done
  - `ls <WORLD>/pools/assistant/knowledge/memory/` → 有 memory 文件
  - `cat` 该文件 → 含合法 frontmatter（`activates_on` 等）+ 内容真提 UTC + JSON Lines
  - memory **没误落** `stones/main/objects/assistant/knowledge/memory`（应在 pools/）
  - assistant 在轮2 回 user 说明了沉淀了什么
- **rubric（对齐 S5 Good 7 条，全中=Good）**：
  - Good：① 轮1 回复提到 UTC/JSON Lines ② super 反思线程 done ③ 轮2 走了 talk(super 入口) ④ memory 落对 pools/ 未误落 stones/ ⑤ ≥1 篇 memory 含合法 frontmatter ⑥ memory 内容真提约定 ⑦ assistant 回 user 说明沉淀
  - OK：无崩溃但缺 ≥1 条（如 memory 没 frontmatter / 没真提约定）
  - Bad：super flow 没触发 / memory 没落 / 误落 stones/

## 探索提示
- 让它沉淀后**再开一轮**，看 memory 是否在新 thread 被正确 activate（reflectable→thinkable 闭环）。
- 让它沉淀一条需要改 self.md 的身份认知，看 self.md 是否经 git commit（署名=self，非 bootstrap）。

## 已知陷阱
- **super flow 独立 job**：必须单独 poll 等其 done，否则 memory 还没落就观察=假阴性。
- **pool flat 布局**：memory 在 `pools/assistant/knowledge/memory/`，**不是** `pools/objects/assistant/...`。
- LLM 方差：轮2 明确引导「通过 super flow 沉淀」可降方差。
