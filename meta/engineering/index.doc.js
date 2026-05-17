import { integration_tests_v20260511_1 } from "@meta/engineering/integration-tests.doc";
import { llm_provider_debugging_v20260513_1 } from "@meta/engineering/llm-provider-debugging.doc";
import { refactoring_governance_v20260512_1 } from "@meta/engineering/refactoring-governance.doc";
import { meta_doc_maintenance_v20260517_1 } from "@meta/engineering/meta-doc-maintenance.doc";

export const engineering_v20260506_1 = {
  title: "section",
  content: `
Engineering 描述 OOC 工程迁移与演进过程中的实践约束。

子文档：
- [integration-tests](./integration-tests.doc.js) — 真 LLM 集成测试策略 + 测试清单 + 历次真 LLM 暴露的 bug 与修复
- [llm-provider-debugging](./llm-provider-debugging.doc.js) — LLM Provider 对接、Responses tool schema 与 400 错误排查知识
- [refactoring-governance](./refactoring-governance.doc.js) — 复杂度治理、文件拆分、测试门禁、验证门禁与文档同步规范
- [meta-doc-maintenance](./meta-doc-maintenance.doc.js) — meta 概念图的日常维护规范：schema / sources 规则 / 验证门禁 / 与重构治理的接口
  `,
  integration_tests: integration_tests_v20260511_1,
  llm_provider_debugging: llm_provider_debugging_v20260513_1,
  refactoring_governance: refactoring_governance_v20260512_1,
  meta_doc_maintenance: meta_doc_maintenance_v20260517_1,
};
