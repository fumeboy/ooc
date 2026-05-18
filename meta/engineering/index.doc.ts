import { integration_tests_v20260511_1 } from "@meta/engineering/integration-tests.doc";
import { llm_provider_debugging_v20260513_1 } from "@meta/engineering/llm-provider-debugging.doc";
import { refactoring_governance_v20260512_1 } from "@meta/engineering/refactoring-governance.doc";
import { meta_doc_maintenance_v20260517_1 } from "@meta/engineering/meta-doc-maintenance.doc";

/* ────────────────────────────────────────────────────────────────
 *  engineering 聚合节点：纯 section 容器，不持有 name 三件套
 * ──────────────────────────────────────────────────────────────── */

/**
 * Engineering section：OOC 工程迁移与演进过程中的实践约束聚合层。
 *
 * 故意不写 `name + description + sources` 三件套——按 walker 规则，本节点
 * 是聚合层（aggregator），不是概念本身，但其子字段会被走查继续递归。
 *
 * 4 个子文档（每个都是合规 concept）：
 * - integration_tests        — 真 LLM 集成测试策略 / fixture / 测试清单 / 已修复 bug
 * - llm_provider_debugging   — LLM Provider 对接、Responses tool schema 与 400 错误排查
 * - refactoring_governance   — 复杂度治理、文件拆分、测试门禁、验证门禁、文档同步
 * - meta_doc_maintenance     — meta 概念图日常维护：schema / sources / 验证门禁
 */
export const engineering_v20260506_1 = {
  title: "section",
  content: "Engineering 描述 OOC 工程迁移与演进过程中的实践约束。",

  integration_tests: integration_tests_v20260511_1,
  llm_provider_debugging: llm_provider_debugging_v20260513_1,
  refactoring_governance: refactoring_governance_v20260512_1,
  meta_doc_maintenance: meta_doc_maintenance_v20260517_1,
};
