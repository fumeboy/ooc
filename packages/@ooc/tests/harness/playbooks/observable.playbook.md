# observable 体验官 Playbook

## 维度 brief
观测能力：LLM observation（每轮 think 的输入/输出/事件记录）、pause 检查、debug 落盘。
**外部可观察落点**：runtime/debug 端点、loop-debug 记录、pause 行为、`<WORLD>` 下 debug 文件。
**注意**：偏内部基础设施，多为间接判据。

## 驱动准备
1. `POST /api/stones {objectId:"assistant", self:"# Assistant"}`
2. `POST /api/runtime/debug/enable` → `GET /api/runtime/debug/status` 确认 enabled。

## 种子场景

### S1 LLM observation 落盘
- **task**：派一个普通任务（「读 docs/note.md 总结要点」，先 seed 该文件）→ 等 done
- **观察**：
  - `GET /api/runtime/flows/<sid>/<assistant>/threads/<tid>/debug/loops` → 每轮 think 应有记录（context windows / tool dispatch / 输出）
  - `GET .../debug/loops/<i>` → 单轮详情完整（有输入 items、输出、事件）
  - `<WORLD>` 下 debug 文件落盘
- **rubric**：
  - Good：每轮 think 都有 loop-debug 记录，含输入+输出+事件，可还原本轮思考
  - OK：有记录但残缺（缺输出/事件）
  - Bad：debug enabled 但无记录 / 端点 500

### S2 pause 行为
- **task**：先 `POST /api/runtime/debug/enable`，跑任务中观察是否可被 pause 检查拦截（若有 global pause 端点：`POST /api/runtime/global-pause/enable` 再派任务）
- **观察**：pause 状态端点 + 任务是否在 pause 点停住、解除后续跑
- **rubric**：Good=pause 被尊重（任务停在检查点）+ 解除后继续；OK=pause 有效但状态查询不清；Bad=pause 无效/任务无视 pause

## 探索提示
- 对比 debug enabled vs disabled 时 loop 记录差异，验证开关真生效。
- 看 observation 是否捕获了 tool dispatch 的 allow/ask/deny 决策。

## 已知陷阱
- 必须先 `debug/enable` 再派任务，否则那轮可能无记录。
- pause 两套抽象（runtime/pause-store + observable pause checker，F6 推迟项）——若行为不一致，记录现象别判 Bad（已知待合并）。
- 端点路径带 `/api/runtime/` 前缀。
