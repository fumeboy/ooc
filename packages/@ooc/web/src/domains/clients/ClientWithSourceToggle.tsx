/**
 * ClientWithSourceToggle — [已渲染 | 源码] 两 tab 切换。
 *
 * 设计要点：
 * - 仅在路径命中（stone client/index.tsx 或 flow client/pages/{name}.tsx）时挂
 * - 默认 "已渲染"；切 "源码" 走 FileViewer
 * - CSS `display:none` 切换两个子视图，**不卸载** —— 保住 ObjectClientRenderer
 *   内部 React state（按钮 click 计数不丢；调试 friendly）
 * - tab 选择不入 URL；纯 transient
 */
import { useEffect, useRef, useState } from "react";
import {
  ObjectClientRenderer,
  type ClientTarget,
} from "./ObjectClientRenderer";
import { FileViewer } from "../files/components/FileViewer";
import type { FileContent } from "../files";
import { fetchAnyFile } from "../files";
import { endpoints } from "../../transport/endpoints";
import { requestJson } from "../../transport/http";
// matchClientTarget + deriveClientPath moved to client-path.ts to share with
// routing.ts (file-link shortcut) and FileViewer (visible preview dispatch).
export { matchClientTarget, isClientEntryPath, deriveClientPath } from "./client-path";

/**
 * 源码 pane 取源：走与渲染 pane (ObjectClientRenderer) 同一条权威路径。
 *
 * 不再用 deriveClientPath 硬编 `stones/<id>/visible/index.tsx` —— 那只认 flat+visible/，
 * 漏掉 versioning 布局 (`stones/<branch>/objects/<id>/...`) 与 legacy `client/index.tsx`，
 * 取不到源码 → 404/空 (FR3 bug)。
 *
 * 改为：① client-source-url endpoint 用 versioning-aware stoneDir + legacy fallback 给出
 * 权威 absPath；② fetchAnyFile(absPath) 取**原始 tsx 文本**（/@fs URL 拿回的是 vite
 * 转译后的模块，不能用作源码展示，故走读任意文件的 endpoint 取磁盘原文）。
 */
async function fetchClientSource(target: ClientTarget): Promise<FileContent> {
  const url =
    target.scope === "stone"
      ? endpoints.clientSourceUrl("stone", target.objectId)
      : endpoints.clientSourceUrl("flow", target.objectId, {
          sessionId: target.sessionId,
          page: target.page,
        });
  const { absPath } = await requestJson<{ absPath: string; fsUrl: string }>(url);
  const file = await fetchAnyFile(absPath);
  return { path: file.path, content: file.content, size: file.size };
}

export interface ClientWithSourceToggleProps {
  target: ClientTarget;
  /** 命中模式时对应的源 tsx 路径，例如 `stones/alan/client/index.tsx`。 */
  sourcePath: string;
}

type Mode = "render" | "source";

export function ClientWithSourceToggle({
  target,
  sourcePath,
}: ClientWithSourceToggleProps) {
  const [mode, setMode] = useState<Mode>("render");
  const [sourceFile, setSourceFile] = useState<FileContent | undefined>(undefined);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | undefined>(undefined);
  // NOT_FOUND（对象没有 visible 实现）不是错误，是预期空态：与渲染 pane 的
  // StoneFallback 行为一致，给友好提示而非内部 not-found 报错。
  const [sourceMissing, setSourceMissing] = useState(false);
  // 用 ref 标记"已发起 fetch"避免把 sourceLoading 放进 deps
  // 否则 effect 在 setSourceLoading(true) 后自己重新跑→cleanup 把 cancelled 置 true
  // → finally 阶段 setSourceLoading(false) 被跳过 → 永远停在 loading
  const inflightRef = useRef(false);

  // target 变化时重置（不同 client target 切换场景）
  useEffect(() => {
    setSourceFile(undefined);
    setSourceError(undefined);
    setSourceMissing(false);
    setSourceLoading(false);
    inflightRef.current = false;
  }, [target]);

  // 切到 source 才 fetch；只在首次 mode→source 时触发
  useEffect(() => {
    if (mode !== "source") return;
    if (sourceFile || inflightRef.current) return;
    inflightRef.current = true;
    setSourceLoading(true);
    setSourceError(undefined);
    setSourceMissing(false);
    let cancelled = false;
    fetchClientSource(target)
      .then((f) => {
        if (!cancelled) setSourceFile(f);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // NOT_FOUND = 该对象没有 visible 实现 → 友好空态；其它才是真错误。
        if (/not\s*found|404/i.test(msg)) {
          setSourceMissing(true);
        } else {
          setSourceError(msg);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setSourceLoading(false);
        inflightRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [mode, target, sourceFile]);

  return (
    <div className="client-toggle">
      <div className="client-toggle-tabs" data-testid="client-toggle-tabs">
        <button
          type="button"
          className={`tab ${mode === "render" ? "active" : ""}`}
          onClick={() => setMode("render")}
          data-testid="tab-render"
        >
          已渲染
        </button>
        <button
          type="button"
          className={`tab ${mode === "source" ? "active" : ""}`}
          onClick={() => setMode("source")}
          data-testid="tab-source"
        >
          源码
        </button>
        <span className="client-toggle-path muted small">{sourcePath}</span>
      </div>

      {/* 两个子视图始终 mount；CSS 控制可见性，避免切回时丢 state。 */}
      <div
        className="client-toggle-body"
        style={{ display: mode === "render" ? "block" : "none" }}
        data-testid="render-pane"
      >
        <ObjectClientRenderer target={target} />
      </div>
      <div
        className="client-toggle-body"
        style={{ display: mode === "source" ? "block" : "none" }}
        data-testid="source-pane"
      >
        {sourceLoading && !sourceFile && (
          <div className="p-4 text-sm text-[var(--muted-foreground)]">加载源码...</div>
        )}
        {sourceMissing && (
          <div className="p-4 text-sm text-[var(--muted-foreground)]" data-testid="source-no-visible">
            <p className="font-medium">该对象暂无自定义界面（visible）</p>
            <p className="mt-2 text-xs">
              这个对象还没有写下自己的 <code>visible/index.tsx</code> —— 切到「已渲染」可看到它的对象名片（self / readme / knowledge）。
            </p>
          </div>
        )}
        {sourceError && (
          <div className="p-4 text-sm">
            <p className="text-red-500 font-medium">源码加载失败</p>
            <pre className="mt-2 text-xs whitespace-pre-wrap">{sourceError}</pre>
          </div>
        )}
        {sourceFile && <FileViewer file={sourceFile} _allowClientPreview={false} />}
      </div>
    </div>
  );
}

// matchClientTarget 已移到 ./client-path.ts，通过 re-export 暴露
