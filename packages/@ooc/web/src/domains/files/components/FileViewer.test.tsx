/**
 * Round 6 Batch A — H-2 fallback test
 *
 * FileViewer 无文件 + 收到 (path, error) 时, 不能再用通用 "Select a file" 占位
 * (会误导用户以为 URL 路径参数没起作用), 必须显式呈现 "File not available" +
 * path + error 摘要, 区分 "未选文件" vs "文件不存在 / 不在 world 内"。
 */
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileViewer } from "./FileViewer";

describe("FileViewer H-2 fallback (file path miss)", () => {
  it("renders 'Select a file' when no path / no error / no file", () => {
    const html = renderToStaticMarkup(<FileViewer />);
    expect(html).toContain("Select a file");
    expect(html).not.toContain("File not available");
  });

  it("renders 'File not available' + path + error when route had path but fetch failed", () => {
    const html = renderToStaticMarkup(
      <FileViewer
        path="meta/object.doc.ts"
        error="HTTP 404: not found"
      />,
    );
    expect(html).toContain("File not available");
    expect(html).toContain("meta/object.doc.ts");
    expect(html).toContain("HTTP 404");
    expect(html).not.toContain("Select a file");
  });

  it("does not pretend error when only path is provided (still loading)", () => {
    const html = renderToStaticMarkup(
      <FileViewer path="meta/object.doc.ts" />,
    );
    // no error → fall back to "Select a file" (loading state shown elsewhere)
    expect(html).toContain("Select a file");
    expect(html).not.toContain("File not available");
  });
});
