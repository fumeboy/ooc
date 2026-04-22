/**
 * kernel/reviewable/review_api 单元测试
 */

import { describe, test, expect } from "bun:test";
import {
  parseUnifiedDiff,
  renderReviewMarkdown,
  buildMultiPerspectiveRecipes,
  llm_methods,
  type ReviewFinding,
} from "../traits/reviewable/review_api/index";

describe("parseUnifiedDiff", () => {
  test("空字符串 → 空数组", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n")).toEqual([]);
  });

  test("单文件单 hunk 解析正确", () => {
    const raw = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 0000001..0000002 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -10,3 +10,4 @@ function foo()",
      " const x = 1;",
      "-const y = 2;",
      "+const y = 3;",
      "+const z = 4;",
      "",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files.length).toBe(1);
    const f = files[0];
    expect(f.path).toBe("src/app.ts");
    expect(f.mode).toBe("modified");
    expect(f.hunks.length).toBe(1);
    const h = f.hunks[0];
    expect(h.oldStart).toBe(10);
    expect(h.newStart).toBe(10);
    expect(h.contextLines).toEqual(["const x = 1;"]);
    expect(h.removedLines).toEqual(["const y = 2;"]);
    expect(h.addedLines).toEqual(["const y = 3;", "const z = 4;"]);
  });

  test("new file 标记识别", () => {
    const raw = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1,2 @@",
      "+line1",
      "+line2",
    ].join("\n");
    const files = parseUnifiedDiff(raw);
    expect(files[0].mode).toBe("added");
    expect(files[0].path).toBe("new.ts");
  });

  test("deleted file 标记识别", () => {
    const raw = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-line1",
      "-line2",
    ].join("\n");
    const files = parseUnifiedDiff(raw);
    expect(files[0].mode).toBe("deleted");
    expect(files[0].path).toBe("old.ts");
  });

  test("renamed file 保留 oldPath", () => {
    const raw = [
      "diff --git a/a.ts b/b.ts",
      "similarity index 90%",
      "rename from a.ts",
      "rename to b.ts",
    ].join("\n");
    const files = parseUnifiedDiff(raw);
    expect(files[0].mode).toBe("renamed");
    expect(files[0].oldPath).toBe("a.ts");
    expect(files[0].path).toBe("b.ts");
  });

  test("多文件多 hunk", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,3 @@",
      " a",
      "+b",
      " c",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -5,1 +5,1 @@",
      "-x",
      "+y",
    ].join("\n");
    const files = parseUnifiedDiff(raw);
    expect(files.length).toBe(2);
    expect(files[0].path).toBe("a.ts");
    expect(files[1].path).toBe("b.ts");
    expect(files[1].hunks[0].removedLines).toEqual(["x"]);
    expect(files[1].hunks[0].addedLines).toEqual(["y"]);
  });
});

describe("renderReviewMarkdown", () => {
  test("空 findings 输出 '无发现'", () => {
    const md = renderReviewMarkdown("", []);
    expect(md).toContain("# Code Review Report");
    expect(md).toContain("_无发现。_");
  });

  test("按 severity 分组", () => {
    const findings: ReviewFinding[] = [
      { path: "a.ts", line: 10, severity: "critical", message: "SQL 注入" },
      { path: "b.ts", severity: "low", message: "命名可改进", suggestion: "改成 userId" },
      { path: "c.ts", line: 5, severity: "high", message: "空指针", category: "security" },
    ];
    const md = renderReviewMarkdown("总体还行", findings);
    expect(md).toContain("## Summary");
    expect(md).toContain("总体还行");
    expect(md).toContain("### CRITICAL (1)");
    expect(md).toContain("### HIGH (1)");
    expect(md).toContain("### LOW (1)");
    expect(md).toContain("a.ts:10");
    expect(md).toContain("b.ts");
    expect(md).toContain("建议：改成 userId");
    expect(md).toContain("[security]");
    /* critical 在 high 之前 */
    expect(md.indexOf("CRITICAL")).toBeLessThan(md.indexOf("HIGH"));
    expect(md.indexOf("HIGH")).toBeLessThan(md.indexOf("LOW"));
  });
});

describe("buildMultiPerspectiveRecipes", () => {
  test("默认 4 视角完整配方", () => {
    const recipes = buildMultiPerspectiveRecipes([
      "security",
      "performance",
      "readability",
      "architecture",
    ]);
    expect(recipes.length).toBe(4);
    for (const r of recipes) {
      expect(r.biasPrompt.length).toBeGreaterThan(0);
      expect(r.forkTitle).toContain(r.persona);
      expect(r.forkDescription.length).toBeGreaterThan(0);
    }
  });

  test("未知 persona 回退到通用模板", () => {
    const r = buildMultiPerspectiveRecipes(["accessibility"]);
    expect(r[0].persona).toBe("accessibility");
    expect(r[0].biasPrompt).toContain("accessibility");
  });
});

describe("llm_methods 契约", () => {
  test("导出 4 个方法", () => {
    const names = ["read_diff", "post_review", "multi_perspective_review", "suggest_fixes"];
    for (const n of names) {
      expect(llm_methods[n]).toBeDefined();
      expect(typeof llm_methods[n].fn).toBe("function");
    }
  });

  test("post_review 的 findings 参数是 required", () => {
    const p = llm_methods.post_review.params.find(p => p.name === "findings");
    expect(p?.required).toBe(true);
  });

  test("suggest_fixes 按 priority 升序排序", async () => {
    const findings: ReviewFinding[] = [
      { path: "a.ts", severity: "low", message: "lo" },
      { path: "b.ts", severity: "critical", message: "cr", suggestion: "fix cr" },
      { path: "c.ts", severity: "high", message: "hi" },
    ];
    const r = await llm_methods.suggest_fixes.fn({} as any, { findings });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { steps: Array<{ path: string; priority: number; change: string }> };
    expect(data.steps[0].path).toBe("b.ts"); /* critical first */
    expect(data.steps[0].change).toBe("fix cr");
    expect(data.steps[1].path).toBe("c.ts");
    expect(data.steps[2].path).toBe("a.ts");
  });

  test("multi_perspective_review 默认 4 视角", async () => {
    const r = await llm_methods.multi_perspective_review.fn({} as any, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { recipes: Array<{ persona: string }>; mergeHint: string };
    expect(data.recipes.length).toBe(4);
    expect(data.mergeHint.length).toBeGreaterThan(0);
  });

  test("post_review 无 prNumber 无 filePath → text 模式返回 markdown", async () => {
    const r = await llm_methods.post_review.fn({} as any, {
      findings: [{ path: "x.ts", severity: "info" as const, message: "m" }],
      summary: "sum",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { mode: string; target: string };
    expect(data.mode).toBe("text");
    expect(data.target).toContain("# Code Review Report");
    expect(data.target).toContain("INFO");
  });

  test("post_review 错误输入（findings 非数组）应返回 error", async () => {
    const r = await llm_methods.post_review.fn({} as any, { findings: "not array" as any });
    expect(r.ok).toBe(false);
  });
});

describe("read_diff 异常路径", () => {
  test("不存在的 rootDir → error（不抛异常）", async () => {
    const r = await llm_methods.read_diff.fn({ rootDir: "/definitely/not/here/xyz" } as any, {
      ref1: "HEAD",
      ref2: "HEAD",
    });
    expect(r.ok).toBe(false);
  });
});
