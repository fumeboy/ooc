/**
 * ImagePreview —— file_window 命中图片扩展名（png/jpg/gif/webp/svg）时的预览块。
 *
 * 实现取舍：
 * - 后端 `/api/file/read` 现在以 utf-8 string 返回内容，二进制图片直接渲染会乱码。
 * - SVG 是文本，可以直接渲染。
 * - 非 SVG 图片：展示 metadata 卡片（path / size / type）+ 一段提示文字，告知用户
 *   后端没有 binary 流出口（这是设计上的当前 limit）。
 *
 * 后续如果开了 binary endpoint，可以把 `<img>` 切换上去。
 */
import { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { fetchAnyFile } from "../query";

interface ImagePreviewProps {
  path: string;
}

export function ImagePreview({ path }: ImagePreviewProps) {
  const ext = path.toLowerCase().match(/\.([a-z]+)$/)?.[1] ?? "";
  const isSvg = ext === "svg";
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; size: number; content: string; truncated: boolean }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    fetchAnyFile(path)
      .then((res) => {
        if (cancelled) return;
        setState({
          kind: "ok",
          size: res.size,
          content: res.content,
          truncated: res.truncated,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (state.kind === "loading") {
    return <div className="image-preview-empty">loading image…</div>;
  }
  if (state.kind === "error") {
    return (
      <div className="image-preview-empty image-preview-error">
        read failed: {state.message}
      </div>
    );
  }

  if (isSvg) {
    return (
      <div className="image-preview">
        <div
          className="image-preview-svg"
          // SVG content trusted: 来自 local file system，user 浏览 own world。
          // 不在公开 multi-tenant 场景使用，与 `/api/file/read` 同等信任边界。
          dangerouslySetInnerHTML={{ __html: state.content }}
        />
        <div className="image-preview-meta">
          <span>{ext.toUpperCase()}</span>
          <span>{state.size}B</span>
          <span title={path}>{path.split("/").slice(-2).join("/")}</span>
        </div>
      </div>
    );
  }

  // 非 SVG 二进制：能拿到的是 utf-8 lossy decode 后的字符串，不能直接渲染。
  // 展示 placeholder + metadata，避免 visually noisy 的乱码。
  return (
    <div className="image-preview image-preview-binary">
      <div className="image-preview-icon">
        <ImageIcon size={32} aria-hidden="true" />
      </div>
      <div className="image-preview-text">
        <div className="image-preview-filename" title={path}>
          {path.split("/").slice(-1)[0]}
        </div>
        <div className="image-preview-meta">
          <span>{ext.toUpperCase()} image</span>
          <span>{state.size}B</span>
        </div>
        <div className="image-preview-note muted small">
          二进制图片预览：当前 dev 后端 `/api/file/read` 以 utf-8 字符串返回，
          非 SVG 图片暂不直接渲染。完整路径：<code>{path}</code>
        </div>
      </div>
    </div>
  );
}

/** 命中已知图片扩展名时返回 true。 */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path);
}
