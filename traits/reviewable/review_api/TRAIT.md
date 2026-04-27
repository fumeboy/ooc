---
namespace: kernel
name: reviewable/review_api
type: how_to_use_tool
version: 1.0.0
description: 代码审查操作工具集 — read_diff / post_review / multi_perspective_review / suggest_fixes
deps:
  - kernel:reviewable
---

# Code Review 操作工具

与父 trait `kernel:reviewable`（how_to_think）配套：reviewable 给出审查的**思路**，本 trait 提供**工具**。

## 可用 API

在 `program` 沙箱内使用 `callMethod("reviewable/review_api", method, args)` 调用。单个方法也可以通过 `open({ type: "command", command: "program", title, trait: "reviewable/review_api", method })` 发起。

### read_diff({ ref1?, ref2?, pr? })

拉取 diff 并解析为结构化数据：

```javascript
const r = await callMethod("reviewable/review_api", "read_diff", { ref1: "main", ref2: "HEAD" });
// r.data = {
//   files: [{
//     path: "src/app.ts",
//     mode: "modified",
//     hunks: [{
//       header: "@@ -10,7 +10,8 @@",
//       oldStart, oldLines, newStart, newLines,
//       addedLines: ["..."], removedLines: ["..."], contextLines: ["..."]
//     }]
//   }],
//   rawLength: 12345
// }
```

### post_review({ findings, summary?, prNumber?, filePath?, rootDir? })

- `prNumber` → 通过 `gh pr comment` 发 PR 评论
- `filePath` → 写 markdown 文件
- 都没传 → 只返回渲染好的 markdown 文本（target 字段就是文本本身）

ReviewFinding 结构：
```typescript
{
  path: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category?: string;   // e.g. "security", "performance"
  message: string;
  suggestion?: string;
}
```

### multi_perspective_review({ personas?, diffRef1?, diffRef2?, pr? })

**返回编排配方**，不真正 fork 线程。默认 personas：`["security", "performance", "readability", "architecture"]`。

```javascript
const r = await callMethod("reviewable/review_api", "multi_perspective_review", {});
// r.data.recipes = [
//   { persona: "security", biasPrompt: "...", forkTitle: "security review", forkDescription: "..." },
//   ...
// ]
// r.data.mergeHint = "对每个 persona，通过 [create_sub_thread] fork 子线程..."
```

调用者 LLM 拿到 recipes 后，自己发起多个 `[create_sub_thread]`，每个注入对应 biasPrompt，子线程 return findings，主线程合并。

### suggest_fixes({ findings })

把 review findings 翻译为 edit_plan 骨架（path / line / change / priority），供"多文件 transaction"迭代消费。

```javascript
const r = await callMethod("reviewable/review_api", "suggest_fixes", { findings: [...] });
// r.data.steps = [{ path, line, change, priority: 1..5 }, ...]
// 按 priority 升序（critical=1 在最前）
```

## 设计说明

- **kernel trait 不反向依赖 thread/engine**：multi_perspective_review 只产出配方，不在 kernel 里调 `fork` API
- **渲染函数 `renderReviewMarkdown` / `parseUnifiedDiff` / `buildMultiPerspectiveRecipes` export 出来**——单元测试可直接覆盖
- **findings 合并去重策略**写在 mergeHint 里由 LLM 执行（同 path:line:severity 视为重复，保留视角标签集合）
