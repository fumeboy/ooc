import * as flowsService from "@src/app/server/modules/flows/service";
import * as threadTransition from "@src/app/server/runtime/thread-transition";
import * as thinkableContext from "@src/thinkable/context";
import * as programCommand from "@src/executable/windows/root/program";
import * as claudeProvider from "@src/thinkable/llm/providers/claude";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";

/**
 * 工程重构规范：复杂度治理不是机械拆文件，而是收敛概念、状态语义和副作用边界。
 *
 * sources（被本规范持续援引的代表性主干模块；不是规范本身的实现，而是规范应用的对象）:
 *  - flowsService    — 控制平面服务，曾承载状态翻转分散的反例
 *  - threadTransition — 状态规则下沉后形成的 transition helper
 *  - thinkableContext — 单文件升级为同名目录的样板
 *  - programCommand   — command 子系统目录化的样板
 *  - claudeProvider   — provider transport / parser 抽离的样板
 */
export const refactoring_governance_v20260512_1 = {
  name: "RefactoringGovernance",
  get parent() { return engineering_v20260506_1; },
  sources: {
    flowsService,
    threadTransition,
    thinkableContext,
    programCommand,
    claudeProvider,
  },
  description: `
工程重构规范

复杂度治理的长期工程规范。目标不是"把文件拆小"，而是持续降低偶然复杂度，
让系统更容易理解、验证、演进。

按内部子规范展开（见各子字段）：

- goal — 三类复杂度与"何为有效治理"
- fileSplit — 文件拆分按主干 / 旁生概念，而不是行数 / 函数数
- stateGovernance — 状态规则集中表达，而不是散落在 service / worker / helper
- directoryShape — 目录结构表达概念边界
- testGate — TDD 与重构优先补的测试类型
- verificationGate — 完成前必须有新鲜验证证据
- commitGranularity — 按语义边界拆 commit
- docSync — 与 meta-doc-maintenance 的接口
- successCriteria — 一次重构是否成功的 5 条判据
`.trim(),

  goal_v20260517_1: {
    index: `
## 1. 重构目标：减少三类复杂度

- **概念混居**：一个实现同时承载多个并列概念，调用方必须理解全部内部细节才能安全修改
- **状态语义分散**：同一个状态转换规则散落在多个模块里，以"补分支"而不是"改规则"的方式演进
- **副作用边界模糊**：目录扫描、状态翻转、入队、网络请求、协议兼容等副作用在同一处混写

如果一次重构没有显著降低这三类复杂度，它通常只是代码搬运，而不是有效治理。
`.trim(),
  },

  fileSplit_v20260517_1: {
    index: `
## 2. 文件拆分原则

按**主干概念 / 旁生概念**划分，不按行数 / 函数数 / "几种状态"机械决策：

- **主干概念**：构成模块主阅读路径的核心职责，应集中在稳定入口
- **旁生概念**：围绕主干生长、但会打扰主路径理解的投影 / 适配 / 格式化 / 协议提示 / 兼容逻辑

治理规则：

1. 主干逻辑尽量集中，避免为了短小而把主路径切碎
2. 旁生逻辑单独下沉，降低阅读主路径时的认知噪音
3. 一个概念已发展出多个稳定子域时，升级为**同名目录**，而不是继续堆在单文件里

### 2.1 主干入口保留

当文件升级为目录：

- 原对外入口保留稳定 import 路径
- 新目录中的 \`index\` 承载主干编排
- render / transport / formatter / protocol / query / adapter 各自下沉

样板：\`src/thinkable/context/\`（主干在 \`index.ts\`、render/knowledge/protocol 下沉）、
\`src/executable/windows/root/program.ts\`（command 入口保留，执行细节迁入 \`src/executable/program/\`）。
`.trim(),
  },

  stateGovernance_v20260517_1: {
    index: `
## 3. 状态语义治理

涉及 thread / job / form / pause / resume / inject / waiting 这类生命周期状态时，
必须优先检查**状态转换规则是否集中表达**。

推荐做法：

- 先定义状态转换 helper / policy，再接入 service / worker / scheduler
- 让 service 层调用状态规则，而不是自己拼接状态翻转分支
- query helper 负责"找出对象"，transition helper 负责"决定对象如何变化"

禁止的坏味道：

- \`status = "running"\` 在多个 service / worker / helper 中手写
- 同一字段清理规则在多处重复出现
- 目录扫描 + 状态判断 + 入队逻辑堆在 HTTP service 中

样板：\`src/app/server/runtime/thread-transition.ts\` 与 \`src/app/server/runtime/thread-query.ts\`
把状态规则从 \`flowsService\` 下沉出来。
`.trim(),
  },

  directoryShape_v20260517_1: {
    index: `
## 4. 目录结构规范

目录结构表达概念边界，而非只反映技术分层。

### 4.1 同名目录升级

某概念满足任一条件时考虑从单文件升级为同名目录：

- 已同时包含主干逻辑和多个稳定旁生概念
- 未来扩展会继续沿同一概念长出子模块
- 读者已不再把它当成 helper，而是当成子系统

### 4.2 Command 子系统目录

对 \`program\` 这类"对外单一 command、对内多执行模式"的能力：

- 对外保持稳定的 command 名称与 usage
- 对内按 shell / function / sandbox / formatter / env adapter 拆为子目录
- command 文件本身只保留 \`KNOWLEDGE\` / path / match / 入口分发 / 参数兜底
`.trim(),
  },

  testGate_v20260517_1: {
    index: `
## 5. 测试门禁

所有重构遵守测试先行；没看见测试先失败，不能声称验证了重构价值。

### 5.1 TDD 最低要求

任一重构步骤至少满足：

1. 先写锁定旧行为或新契约的测试
2. 明确看见失败，且失败原因正确
3. 写最小实现使之通过
4. 再进行结构整理

### 5.2 重构优先补的测试类型

- **状态契约测试**：inject / resume / done → running 等转换规则
- **目录迁移保护测试**：入口 import 路径不变、主干 API 不变
- **协议兼容测试**：provider 遇到 SSE / 非法 JSON / 代理差异时的降级策略
- **热加载契约测试**：刚写完 server method 立即可调用

### 5.3 避免的低价值测试

- 只重复实现细节、不表达行为意图
- 只验证 mock 调用了几次、没锁定真正对外契约
- 因重构而重写大段无关测试
`.trim(),
  },

  verificationGate_v20260517_1: {
    index: `
## 6. 验证门禁

重构完成前必须有新鲜验证证据；"应该可以"不能代替结果。

### 6.1 至少验证

- 本次修改直接覆盖的目标测试
- 受影响模块的分组测试
- TypeScript 类型检查
- 新增 / 修改文件的 diagnostics

### 6.2 推荐验证顺序

1. 跑最小目标测试
2. 跑模块级测试切片
3. 跑类型检查
4. 查看 diagnostics
5. 最后再决定是否 commit / push

### 6.3 禁止

- 没重新跑验证命令就声称"通过"
- 只因单测绿就忽略 \`tsc\` / diagnostics
- 验证失败时继续提交，期待后续再补
`.trim(),
  },

  commitGranularity_v20260517_1: {
    index: `
## 7. 提交粒度

按**语义边界**拆 commit，而不是按"今天改了哪些文件"。

推荐粒度：

- 一次 commit 收敛一组状态规则
- 一次 commit 下沉一个旁生概念
- 一次 commit 迁移一个目录并保留兼容入口

不推荐：把状态迁移 / 目录搬家 / 文档更新 / provider 改造全塞进一个不可审阅的大提交。
`.trim(),
  },

  docSync_v20260517_1: {
    index: `
## 8. 文档同步规范

凡是重构改变了下列任一项，都应同步文档：

- 目录结构
- 长期工程准则
- 对外心智模型
- 测试 / 验证 / 运行方式

文档同步优先级：

1. 先更新长期规范文档（本文件 / meta-doc-maintenance）
2. 再更新本轮 spec / plan
3. 历史结果性文档只做最小必要修正，不大面积回填

具体落地：meta 文档同步靠 meta-doc-maintenance 规范的机器闸
（\`bun tsc --noEmit\` + \`bun test meta/__tests__\`），不靠纪律。任何重构在合规下都会
顺带跑一遍 meta 一致性检查。

约束反过来：源码改名 / 删除 → 对应 \`.doc.js\` 的 \`import * as ns\` 立即 tsc 失败。
失同步状态在门禁层即被拦下。
`.trim(),
  },

  successCriteria_v20260517_1: {
    index: `
## 9. 一次重构是否成功

完成后应能回答：

1. 主干阅读路径是否更短、更清楚？
2. 状态规则是否更集中，而不是更分散？
3. 旁生概念是否被下沉，而不是继续混在主流程里？
4. 测试是否锁住了关键行为？
5. 验证证据是否新鲜且完整？

5 个问题里有 ≥2 个回答"否" → 这次重构还没有真正完成。
`.trim(),
  },
};
