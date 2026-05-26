/**
 * FileWindowDiff.test — Round 10 F3.
 *
 * Web 工程无 React Testing Library；这里通过直接调用 renderer 函数（它是普通 React
 * function component）并对返回的 ReactElement 树做结构断言。
 *
 * 覆盖（design § F3-3）：
 *   - Case A: fileDiff present → 渲染 FileMergeView（含 data-testid="file-window-diff-*"）
 *   - Case B: fileDiff.isBinary → 渲染 binary 提示 Notice
 *   - Case C: fileDiff.tooLarge → too large 提示
 *   - Case D: fileDiff 缺失但有 content → fallback synthetic FileMergeView
 *   - Case E: fileDiff 缺失且无 content → 软退化 Notice（不崩）
 *   - Case F: added 状态（previous undefined）
 *   - Case G: removed 状态（current undefined）
 */

import { describe, expect, it } from "bun:test";
import { FileWindowDiff } from "./FileWindowDiff";
import {
  containsText as utilContainsText,
  findTestId as utilFindTestId,
} from "./test-utils";

function makeFileDiff(opts?: {
  isBinary?: boolean;
  tooLarge?: boolean;
  previousContent?: string;
  currentContent?: string;
  path?: string;
}) {
  return {
    id: "w_file_1",
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

const findTestId = utilFindTestId;
const containsText = utilContainsText;

describe("FileWindowDiff", () => {
  it("Case A: fileDiff present → 渲染 mergeview host (data-testid)", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff(),
      windowType: "file",
      windowId: "w_file_1",
    });
    expect(findTestId(tree, "file-window-diff-w_file_1")).toBe(true);
  });

  it("Case B: isBinary → 渲染 binary 提示", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff({ isBinary: true }),
      windowType: "file",
      windowId: "w_file_b",
    });
    expect(containsText(tree, "binary")).toBe(true);
  });

  it("Case C: tooLarge → 渲染 too large 提示", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff({ tooLarge: true }),
      windowType: "file",
      windowId: "w_file_c",
    });
    expect(containsText(tree, "too large")).toBe(true);
  });

  it("Case D: fileDiff 缺失但有 content fallback → synthetic mergeview", () => {
    const tree = FileWindowDiff({
      previous: { id: "w", type: "file", content: "old text", path: "src/x.ts" },
      current: { id: "w", type: "file", content: "new text", path: "src/x.ts" },
      windowType: "file",
      windowId: "w_file_d",
    });
    expect(findTestId(tree, "file-window-diff-w_file_d")).toBe(true);
    expect(containsText(tree, "fallback content")).toBe(true);
  });

  it("Case E: fileDiff 缺失且无 content → 软退化 Notice", () => {
    const tree = FileWindowDiff({
      previous: { id: "w", type: "file" }, // 无 content / fileDiff
      current: { id: "w", type: "file" },
      windowType: "file",
      windowId: "w_file_e",
    });
    expect(containsText(tree, "not yet available")).toBe(true);
    // 不崩
    expect(tree).toBeDefined();
  });

  it("Case F: added (previous=undefined) + 有 fileDiff → 渲染且 data-added 标记", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: makeFileDiff(),
      windowType: "file",
      windowId: "w_file_f",
    });
    expect(findTestId(tree, "file-window-diff-w_file_f")).toBe(true);
    // 测树深处 data-added 属性
    const flat = JSON.stringify(tree);
    expect(flat).toContain("data-added");
  });

  it("Case G: removed (current=undefined) + previous 上有 fileDiff → 渲染", () => {
    const tree = FileWindowDiff({
      previous: makeFileDiff(),
      current: undefined,
      windowType: "file",
      windowId: "w_file_g",
    });
    expect(findTestId(tree, "file-window-diff-w_file_g")).toBe(true);
  });

  it("Case H: 完全空 props → 软退化（不崩）", () => {
    const tree = FileWindowDiff({
      previous: undefined,
      current: undefined,
      windowType: "file",
      windowId: "w_file_h",
    });
    expect(tree).toBeDefined();
    expect(containsText(tree, "not yet available")).toBe(true);
  });
});
