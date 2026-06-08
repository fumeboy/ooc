/**
 * file-visible-diff.test — 补强 2：迁移自 web FileWindowDiff.test.ts 的 7 个行为 case。
 *
 * 覆盖：
 *   - Case A: fileDiff present → 渲染 mergeview host (data-testid="file-window-diff")
 *   - Case B: fileDiff.isBinary → 渲染 binary 提示 Notice
 *   - Case C: fileDiff.tooLarge → too large 提示
 *   - Case D: fileDiff 缺失但有 content → fallback synthetic FileMergeView
 *   - Case E: fileDiff 缺失且无 content → 软退化 Notice（不崩）
 *   - Case F: added 状态（previous=undefined）
 *   - Case G: removed 状态（current=undefined）
 */

import { describe, expect, it } from "bun:test";
import FileWindowDiff from "@ooc/builtins/file/visible/diff";
import {
  containsText,
  findTestId,
} from "@ooc/web/src/domains/sessions/components/window-diff-renderers/test-utils";

function makeFileDiff(opts?: {
  isBinary?: boolean;
  tooLarge?: boolean;
  previousContent?: string;
  currentContent?: string;
  path?: string;
}) {
  return {
    type: "file",
    contentHash: "h_cur",
    fileDiff: {
      previousContent: opts?.previousContent ?? "old\nline\n",
      currentContent: opts?.currentContent ?? "new\nline\n",
      path: opts?.path ?? "src/a.ts",
      isBinary: opts?.isBinary,
      tooLarge: opts?.tooLarge,
    },
  };
}

describe("FileWindowDiff (builtins visible/diff)", () => {
  it("Case A: fileDiff present → 渲染 mergeview host (data-testid)", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff(),
    });
    expect(findTestId(tree, "file-window-diff")).toBe(true);
  });

  it("Case B: isBinary → 渲染 binary 提示", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff({ isBinary: true }),
    });
    expect(containsText(tree, "binary")).toBe(true);
  });

  it("Case C: tooLarge → 渲染 too large 提示", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff({ tooLarge: true }),
    });
    expect(containsText(tree, "too large")).toBe(true);
  });

  it("Case D: fileDiff 缺失但有 content fallback → synthetic mergeview", () => {
    const tree = FileWindowDiff({
      previous: { type: "file", content: "old text", path: "src/x.ts" },
      current: { type: "file", content: "new text", path: "src/x.ts" },
    });
    expect(findTestId(tree, "file-window-diff")).toBe(true);
    expect(containsText(tree, "fallback content")).toBe(true);
  });

  it("Case E: fileDiff 缺失且无 content → 软退化 Notice", () => {
    const tree = FileWindowDiff({
      previous: { type: "file" }, // 无 content / fileDiff
      current: { type: "file" },
    });
    expect(containsText(tree, "not yet available")).toBe(true);
    // 不崩
    expect(tree).toBeDefined();
  });

  it("Case F: added (previous=undefined) + 有 fileDiff → 渲染且 data-added 标记", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff(),
    });
    expect(findTestId(tree, "file-window-diff")).toBe(true);
    // 测树深处 data-added 属性
    const flat = JSON.stringify(tree);
    expect(flat).toContain("data-added");
  });

  it("Case G: removed (current=undefined) + previous 上有 fileDiff → 渲染", () => {
    const tree = FileWindowDiff({
      previous: makeFileDiff(),
      current: undefined,
    });
    expect(findTestId(tree, "file-window-diff")).toBe(true);
  });
});
