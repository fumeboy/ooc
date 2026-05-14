import * as flowsService from "@src/app/server/modules/flows/service";
import * as threadTransition from "@src/app/server/runtime/thread-transition";
import * as thinkableContext from "@src/thinkable/context";
import * as programCommand from "@src/executable/windows/root/program";
import * as claudeProvider from "@src/thinkable/llm/providers/claude";
import { engineering_v20260506_1 } from "@meta/engineering/index.doc";

/**
 * 工程重构规范：
 * - 复杂度治理不是机械拆文件，而是收敛概念、状态语义和副作用边界
 * - 主干概念集中，旁生概念下沉
 * - 测试与验证门禁是重构的一部分，不是收尾动作
 */
export const refactoring_governance_v20260512_1 = {
  get parent() { return engineering_v20260506_1; },
  sources: {
    flowsService,
    threadTransition,
    thinkableContext,
    programCommand,
    claudeProvider,
  },
  index: `
工程重构规范

这份文档沉淀 OOC 在复杂度治理上的长期工程规范。目标不是"把文件拆小"，而是持续降低偶然复杂度，使系统更容易理解、验证和演进。

## 1. 重构目标

重构的首要目标是减少以下三类复杂度：

- **概念混居**：一个实现同时承载多个并列概念，调用方必须理解全部内部细节才能安全修改
- **状态语义分散**：同一个状态转换规则散落在多个模块里，以"补分支"而不是"改规则"的方式演进
- **副作用边界模糊**：目录扫描、状态翻转、入队、网络请求、协议兼容等副作用在同一处混写

如果一次重构没有显著降低这三类复杂度，它通常只是代码搬运，而不是有效治理。

## 2. 文件拆分原则

文件拆分不按行数、函数数或"一个文件里有几种状态"来机械决策，而按**主干概念 / 旁生概念**划分：

- **主干概念**：构成一个模块主阅读路径的核心职责，应该集中在一个稳定入口中
- **旁生概念**：围绕主干概念生长出来、但会打扰主路径理解的投影、适配、格式化、协议提示或兼容逻辑

治理规则：

1. 主干逻辑尽量集中，避免为了短小而把主路径切碎
2. 旁生逻辑单独下沉，降低阅读主路径时的认知噪音
3. 如果一个概念已经发展出多个稳定子域，应优先升级为**同名目录**，而不是继续堆在单文件里

### 2.1 主干入口保留规则

当一个文件升级为目录时：

- 原有对外入口应尽量保留稳定 import 路径
- 新目录中的 \`index\` 承载主干编排
- render / transport / formatter / protocol / query / adapter 这类旁生概念各自下沉

示例：

- \`src/thinkable/context/\`：主干入口保留在 \`index.ts\`
- \`src/executable/program/\`：\`commands/program.ts\` 保留 command 入口，执行细节下沉到 \`program/\`

## 3. 状态语义治理规则

只要一个功能涉及 thread / job / form / pause / resume / inject / waiting 这类生命周期状态，就必须优先检查**状态转换规则是否集中表达**。

推荐做法：

- 先定义状态转换 helper / policy，再接入 service、worker、scheduler
- 让 service 层调用状态规则，而不是自己拼接状态翻转分支
- query helper 负责"找出对象"，transition helper 负责"决定对象如何变化"

禁止的坏味道：

- \`status = "running"\` 在多个 service / worker / helper 中手写
- 同一个字段清理规则（例如 \`waitingType\` / \`awaitingChildren\`）在多个地方重复出现
- 目录扫描 + 状态判断 + 入队逻辑堆在 HTTP service 中

## 4. 目录结构规范

目录结构本身就是复杂度治理的一部分，应该表达概念边界，而不是只反映技术分层。

### 4.1 同名目录升级

当某个概念满足以下任意条件时，应考虑从单文件升级为同名目录：

- 已经同时包含主干逻辑和多个稳定旁生概念
- 未来扩展会继续沿同一概念长出子模块
- 读者已经不再把它当成一个 helper，而是当成一个子系统

### 4.2 Command 子系统目录

对于 \`program\` 这类对外是单一 command、对内却是多执行模式的能力：

- 对外保持一个稳定 command 名称和 usage
- 对内按 shell / function / sandbox / formatter / env adapter 拆为子目录
- command 文件本身只保留 \`KNOWLEDGE\`、path/match、入口分发和参数兜底

## 5. 测试门禁

所有重构都必须遵守测试先行的门禁。没有看见测试先失败，就不能声称自己验证了重构价值。

### 5.1 TDD 最低要求

对于任一重构步骤，至少满足以下顺序：

1. 先写一个锁定旧行为或新契约的测试
2. 明确看见它失败，而且失败原因正确
3. 写最小实现使之通过
4. 再进行结构整理

### 5.2 重构优先补的测试类型

- **状态契约测试**：例如 inject / resume / done → running 的转换规则
- **目录迁移保护测试**：例如入口 import 路径不变、主干 API 不变
- **协议兼容测试**：例如 provider 遇到 SSE / 非法 JSON / 代理差异时的降级策略
- **热加载契约测试**：例如"刚写完 server method 立即可调用"

### 5.3 避免的低价值测试

- 只重复实现细节、不表达行为意图的测试
- 只验证 mock 调用了几次、没有锁定真正对外契约的测试
- 因为重构而重写大段无关测试

## 6. 验证门禁

重构完成前，必须有新鲜验证证据，不允许用"应该可以"代替结果。

### 6.1 完成前至少验证

- 本次修改直接覆盖的目标测试
- 受影响模块的分组测试
- TypeScript 类型检查
- 新增或修改文件的 diagnostics

### 6.2 推荐验证顺序

1. 跑最小目标测试
2. 跑模块级测试切片
3. 跑类型检查
4. 查看 diagnostics
5. 最后再决定是否 commit / push

### 6.3 禁止的做法

- 没重新跑验证命令就声称"通过"
- 只因为单测绿了就忽略 \`tsc\` 或 diagnostics
- 在验证失败时继续提交，期待后续再补

## 7. 提交粒度规范

重构提交应按**语义边界**拆分，而不是按"今天改了哪些文件"拆分。

推荐粒度：

- 一次 commit 收敛一组状态规则
- 一次 commit 下沉一个旁生概念
- 一次 commit 迁移一个目录并保留兼容入口

不推荐：

- 把状态迁移、目录搬家、文档更新、provider 改造全部塞进一个不可审阅的大提交

## 8. 文档同步规范

凡是重构改变了以下任一项，都应同步文档：

- 目录结构
- 长期工程准则
- 对外心智模型
- 测试 / 验证 / 运行方式

文档同步优先级：

1. 先更新长期规范文档（例如本文件）
2. 再更新本轮 spec / plan
3. 历史结果性文档只做最小必要修正，不做大面积回填

## 9. 近期案例

以下案例代表本规范的落地方式：

- \`flows/service\` 中的 inject / resume 状态翻转下沉为 \`thread-transition\`
- paused thread 扫描下沉为 query helper，而不是继续堆在 service 层
- \`context\` 从单文件升级为同名目录，主干入口保留，render / knowledge / protocol 下沉
- \`program\` 保留 command 入口，执行逻辑迁入 \`src/executable/program/\`
- \`claude\` provider 把 transport/retry 与 SSE parser 抽离，主文件仅保留编排

## 10. 判断一次重构是否成功

一次重构完成后，应能回答以下问题：

1. 主干阅读路径是否更短、更清楚？
2. 状态规则是否更集中，而不是更分散？
3. 旁生概念是否被下沉，而不是继续混在主流程里？
4. 测试是否锁住了关键行为？
5. 验证证据是否新鲜且完整？

如果这 5 个问题里有 2 个以上回答为"否"，说明这次重构还没有真正完成。
`,
};
