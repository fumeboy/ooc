/**
 * ClientWithSourceToggle — [已渲染 | 源码] 两 tab 切换。
 *
 * 设计要点（plan-003 §3.2）：
 * - 仅在路径命中 §3.1（stone client/index.tsx 或 flow client/pages/{name}.tsx）时挂
 * - 默认 "已渲染"；切 "源码" 走 FileViewer
 * - CSS `display:none` 切换两个子视图，**不卸载** —— 保住 ObjectClientRenderer
 *   内部 React state（按钮 click 计数不丢；调试 friendly）
 * - tab 选择不入 URL（plan-003 D1）；纯 transient
 */
import { useEffect, useRef, useState } from "react";
import {
  ObjectClientRenderer,
  type ClientTarget,
} from "./ObjectClientRenderer";
import { FileViewer } from "../files/components/FileViewer";
import type { FileContent } from "../files";
import { fetchFile } from "../files";

export interface ClientWithSourceToggleProps {
  target: ClientTarget;
  /** 命中 §3.1 模式时对应的源 tsx 路径，例如 `stones/alan/client/index.tsx`。 */
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
  // 用 ref 标记"已发起 fetch"避免把 sourceLoading 放进 deps
  // 否则 effect 在 setSourceLoading(true) 后自己重新跑→cleanup 把 cancelled 置 true
  // → finally 阶段 setSourceLoading(false) 被跳过 → 永远停在 loading
  const inflightRef = useRef(false);

  // sourcePath 变化时重置（不同 client target 切换场景）
  useEffect(() => {
    setSourceFile(undefined);
    setSourceError(undefined);
    setSourceLoading(false);
    inflightRef.current = false;
  }, [sourcePath]);

  // 切到 source 才 fetch；只在首次 mode→source 时触发
  useEffect(() => {
    if (mode !== "source") return;
    if (sourceFile || inflightRef.current) return;
    inflightRef.current = true;
    setSourceLoading(true);
    setSourceError(undefined);
    let cancelled = false;
    fetchFile(sourcePath)
      .then((f) => {
        if (!cancelled) setSourceFile(f);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
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
  }, [mode, sourcePath, sourceFile]);

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
        {sourceError && (
          <div className="p-4 text-sm">
            <p className="text-red-500 font-medium">源码加载失败</p>
            <pre className="mt-2 text-xs whitespace-pre-wrap">{sourceError}</pre>
          </div>
        )}
        {sourceFile && <FileViewer file={sourceFile} />}
      </div>
    </div>
  );
}

/**
 * 把"world 相对路径"匹配到 ClientTarget；不命中返回 undefined。
 * 与 plan-003 §3.1 的两条 regex 一致。
 */
export function matchClientTarget(path: string): ClientTarget | undefined {
  // 2026-05-21 stones repo 重组：bare repo + linked worktrees，stone client 路径变成
  // `stones/<stonesBranch>/objects/<objectId>/client/index.tsx`；第一段 branch 不捕获，
  // 第二段 objects/<objectId> 才是 client 入口的 owner。
  const stone = /^stones\/[^/]+\/objects\/([^/]+)\/client\/index\.tsx$/.exec(path);
  if (stone) return { scope: "stone", objectId: stone[1]! };
  const flow = /^flows\/([^/]+)\/objects\/([^/]+)\/client\/pages\/([A-Za-z0-9_-]+)\.tsx$/.exec(path);
  if (flow) {
    return {
      scope: "flow",
      sessionId: flow[1]!,
      objectId: flow[2]!,
      page: flow[3]!,
    };
  }
  return undefined;
}
