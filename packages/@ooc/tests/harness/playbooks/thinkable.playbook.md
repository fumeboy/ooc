# thinkable 体验官 Playbook

## 维度 brief
思考能力：context 构建（5 processor pipeline）、knowledge 激活、多轮上下文连贯、budget 分配。
**外部可观察落点**：多轮 thread 回复连贯性（行为质量）+ loop-debug（context windows / knowledge 激活 / budget）。
**注意**：本维度偏内部，多为**间接判据**，报告须诚实标注主观性。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant"}`
2. 预置一份 knowledge 让其可被激活：给 assistant pool 写一条 knowledge（或在 task 里引用 docs/ 文件），
   seed 文件：`<WORLD>/...` 写 `docs/spec.md`，内容含一条独特约定（如「ID 必须用 ULID」）。
3. 先 `POST /api/runtime/debug/enable` 开 loop-debug。

## 种子场景

### S1 多轮连贯
- **task 轮1**：「读 docs/spec.md，这个项目对 ID 有什么约定？」→ 等 done
- **task 轮2**（`/continue`）：「那如果我要给用户表加主键，按这个约定该怎么写？」
- **观察**：轮2 回复是否**正确沿用轮1 学到的约定**（ULID）；`GET /api/flows/<sid>/threads` 连贯性
- **rubric**：Good=轮2 正确引用 ULID 约定且无需重读；OK=沿用了但要重读/含糊；Bad=轮2 忘了约定/答非所问

### S2 knowledge 激活
- **task**：派一个会命中预置 knowledge 的任务（如「帮我设计这张表」），看 knowledge 是否被激活注入
- **观察**：loop-debug `GET /api/runtime/flows/<sid>/<assistant>/threads/<tid>/debug/loops` → 看某轮 context windows 是否含该 knowledge window + 回复是否体现
- **rubric**：Good=loop-debug 显示 knowledge 被激活且回复体现；OK=激活了但回复没用上；Bad=该激活却没激活（间接判据）

## 探索提示
- 给一个长任务看 budget 是否触发 compress（loop-debug 里 context_compressed 事件）。
- 多轮后看早期 window 是否被正确保留/压缩，上下文不丢。

## 已知陷阱
- **间接维度**：很多只能从「行为质量」判，rubric 命中与否有主观性 → 报告标注。
- loop-debug 需先 `debug/enable`，否则可能无记录。
- budget/token 估算行为敏感（A8/G3 推迟项），别据此判 Bad，只观察现象。
