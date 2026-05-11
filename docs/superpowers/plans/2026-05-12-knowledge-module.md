# Knowledge Module Implementation Plan

> Goal: 把 spec `2026-05-12-knowledge-module-design.md` 落地。

**Architecture:** lazy 求值 + mtime cache。每次 buildContext 调 activator 算激活集合，无 thread 上的派生状态字段。yaml-frontmatter 解析用 js-yaml。

---

### Task 1: 依赖 + 数据类型

**Files:** `package.json`, `src/thinkable/knowledge/types.ts`

- [ ] `bun add js-yaml` + `bun add -d @types/js-yaml`
- [ ] 创建 `src/thinkable/knowledge/types.ts`（按 spec §I）
- [ ] `bunx tsc --noEmit` 通过
- [ ] Commit `feat(knowledge): add types and dependency`

---

### Task 2: parser + 单测

**Files:** `src/thinkable/knowledge/parser.ts`, `src/thinkable/knowledge/__tests__/parser.test.ts`

- [ ] 先写测试：正常 frontmatter / 没有 frontmatter / frontmatter 未闭合 / yaml 损坏 / 空文件
- [ ] 确认失败
- [ ] 实现 parser（按 spec §II）
- [ ] 测试通过
- [ ] Commit `feat(knowledge): parser for frontmatter + body`

---

### Task 3: loader + 热重载单测

**Files:** `src/thinkable/knowledge/loader.ts`, `__tests__/loader.test.ts`

- [ ] 测试：
  - 空 knowledge/ 返回空 index
  - 多文件 + 子目录扫描正确，path 用斜杠
  - 同 stone 二次调用走 cache（参考 mtime 不变）
  - mtime 变化后重扫
- [ ] 实现 loader（按 spec §III）
- [ ] 测试通过；导出 `clearKnowledgeLoaderCache` 给测试用
- [ ] Commit `feat(knowledge): file loader with mtime cache`

---

### Task 4: activator + 单测

**Files:** `src/thinkable/knowledge/activator.ts`, `__tests__/activator.test.ts`

- [ ] 测试：
  - 空 thread 无激活
  - pinned 总是 full
  - command path 命中 show_content_when → full
  - command path 命中 show_description_when → summary
  - 同篇同时命中 full + summary → full 优先
  - pinned 不存在的 path 静默忽略
  - 超过 20 项截断
- [ ] 实现 activator（按 spec §IV）
- [ ] Commit `feat(knowledge): command-path activator`

---

### Task 5: src/thinkable/knowledge/index.ts re-export

- [ ] re-export types + parser + loader + activator
- [ ] Commit `feat(knowledge): barrel exports`

---

### Task 6: context 改造 + 渲染单测

**Files:** `src/thinkable/context.ts`, `src/thinkable/__tests__/context.test.ts`

- [ ] 删 `ThreadContext.activatedKnowledge` 字段（spec §III/V）
- [ ] buildContext 调 loader + activator + renderActiveKnowledge
- [ ] 加 renderActiveKnowledge + truncateKnowledge helper
- [ ] 单测：summary 形 vs full 形渲染；空集合时不输出 `<active_knowledge>`
- [ ] 全单元测试通过；任何依赖删字段的测试同步改
- [ ] Commit `feat(knowledge): render active_knowledge in context`

---

### Task 7: open/close 工具改造

**Files:** `src/executable/tools/open.ts`, `src/executable/tools/close.ts`, `src/executable/__tests__/tools.test.ts`

- [ ] open.ts：删 `thread.activatedKnowledge` 写入，只保留 `pinnedKnowledge`
- [ ] close.ts：加 `type === "knowledge"` 分支，调整 schema required，写好 inject 文案
- [ ] tools 单测：close(type=knowledge, path=X) 真的把 path 从 pinnedKnowledge 移除；close(form_id=X) 仍正常
- [ ] Commit `feat(knowledge): manual pin/unpin via open/close tools`

---

### Task 8: 文档同步

**Files:** `meta/object/thinkable/knowledge/index.doc.js`

- [ ] 加 sources 绑定（src/thinkable/knowledge/*）
- [ ] 加"当前实现阶段"段：覆盖了什么、没覆盖什么、上限值
- [ ] tsc 通过
- [ ] Commit `docs(knowledge): bind sources and document phase scope`

---

### Task 9: 集成测试

**Files:** `tests/integration/knowledge-activation.integration.test.ts`

场景：
- 先用 program.shell 在 `stone/agent/knowledge/file-ops.md` 写一篇 knowledge（含 activates_on: show_content_when: [program.shell]）
- 让 Agent open(program, language=shell, code=...)
- 验证 LLM 下一轮看到 `<active_knowledge>` 中有 file-ops 全文
- Agent 完成后 end

- [ ] 写测试
- [ ] `bun --env-file=.env test tests/integration/knowledge-activation.integration.test.ts` 一次通过
- [ ] Commit `test(integration): knowledge auto-activation end-to-end`

---

### Task 10: 收敛验证

- [ ] `bun test src` 全绿
- [ ] `bunx tsc --noEmit` exit 0
- [ ] 更新 `meta/iteration.doc.js` 加阶段 5 后续微调节点
- [ ] Commit `docs: log knowledge module iteration node`
