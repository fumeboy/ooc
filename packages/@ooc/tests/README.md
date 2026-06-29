# `packages/@ooc/tests/` —— OOC storybook(就地)

本目录承担 OOC **storybook** 角色——每个 `.test.ts` 文件 = 一条能力 story,验证设计权威
某个元素的兑现。**不另造 `packages/@ooc/storybook/` 包**(避免双轨),tests/ 即 storybook。

完整设计 + 演进路径见 `docs/ooc-6/storybook/dashboard.md`(覆盖矩阵)+ issue
`2026-06-29-f5-storybook-survey.md`(裁决记录)。

## 当前规模(2026-06-29)

- 27 个 `.test.ts` 文件
- 134 cases
- 0 fail
- CI gate = `bun run verify`(parent repo)

## 约定: test 文件头注释

新增 test 文件应在头部 JSDoc 注释中**锚定设计元素**:

```ts
/**
 * <一句话该 test 覆盖什么>。
 *
 * 设计权威: <issue path / objects 路径>
 * Tier: A(控制面确定性,可 CI gate) | B(agent-native,真 LLM,env-gated)
 * 覆盖元素: <knowledge/index.md ## 元素 / self.md 核心 N>
 */
```

例:

```ts
/**
 * lifecycle on_reload 派发测试(issue 2026-06-28-lifecycle-module-and-reload Stage B)。
 *
 * 设计权威: .ooc-world-meta/.../children/lifecycle/self.md
 * Tier: A
 * 覆盖元素: ## lifecycle / ## OOC Class/Object Model 核心 11 / object/self.md 核心 11
 */
```

这条约定让 grep 能扫出能力索引,后续 Phase C 自动化生成 dashboard.md。

## 约定: 命名

- 测试 issue 引入的新机制时,文件名宜含 issue 简称(如 `lifecycle-on-reload.test.ts`)
  或机制名(如 `refcount-gc.test.ts`)。
- 跨维度 e2e 测试用 `<module>-e2e.test.ts`(如 `thinkloop-e2e.test.ts`)。

## Tier A vs Tier B

- **Tier A**(默认): 控制面确定性,零真 LLM(或 mock),`bun:test` 直跑,进 CI gate。当前
  27 个文件全是 Tier A。
- **Tier B**: agent-native,真 LLM,env-gated(`RUN_STORYBOOK_AGENT=1`),不进 CI。当前
  **未实现**(F5 Phase B follow-up)。

## 跑测试

```bash
# 全部 (除 web-e2e 需 packages/@ooc/web 存在; 主仓库有, fresh worktree 无)
bun test packages/@ooc/tests/

# 单文件
bun test packages/@ooc/tests/lifecycle-on-reload.test.ts

# CI gate (含 tsc + 4 个 check + tests)
bun run verify
```

## 不在本目录的 test

- **builtin 私有 unit test**: `packages/@ooc/builtins/<x>/__tests__/`(若有)
- **core 私有 unit test**: `packages/@ooc/core/<x>/__tests__/`(若有)
- 本目录是**跨模块集成 / 能力 story**,不放纯单元测试。
