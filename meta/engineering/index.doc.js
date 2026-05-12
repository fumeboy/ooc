import { integration_tests_v20260511_1 } from "@meta/engineering/integration-tests.doc";
import { refactoring_governance_v20260512_1 } from "@meta/engineering/refactoring-governance.doc";

export const engineering_v20260506_1 = {
  index: `
Engineering 描述 OOC 工程迁移与演进过程中的实践约束。

子文档：
- [integration-tests](./integration-tests.doc.js) — 真 LLM 集成测试策略 + 测试清单 + 历次真 LLM 暴露的 bug 与修复
- [refactoring-governance](./refactoring-governance.doc.js) — 复杂度治理、文件拆分、测试门禁、验证门禁与文档同步规范
`,
  integration_tests: integration_tests_v20260511_1,
  refactoring_governance: refactoring_governance_v20260512_1,
};
