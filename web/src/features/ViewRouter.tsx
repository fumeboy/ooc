/**
 * ViewRouter — 根据文件路径选择展示组件
 *
 * 路由规则：
 * 1. stones/{objectId} → StoneView (ObjectDetail)
 * 2. flows/{sessionId} → SessionView (ChatPage with session)
 * 3. flows/{sessionId}/{objectId} → FlowDetail
 * 4. *.json → JSON 查看器
 * 5. *.md → Markdown 渲染
 * 6. 其余 → 纯文本
 */
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { refreshKeyAtom } from "../store/session";
import { fetchFileContent } from "../api/client";
import { ObjectDetail } from "./ObjectDetail";
import { DynamicUI } from "./DynamicUI";
import { FlowView } from "./FlowView";
import { ChatPage } from "./ChatPage";
import { ProcessView } from "./ProcessView";
import { MarkdownContent } from "../components/ui/MarkdownContent";
import { CodeMirrorViewer } from "../components/ui/CodeMirrorViewer";
import { hasCustomUI } from "../objects";
import { talkTo } from "../api/client";
import type { Process } from "../api/types";
import type { StoneUIProps } from "../types/stone-ui";

interface ViewRouterProps {
  filePath: string;
}

/** 解析路径，判断路由类型 */
function parseRoute(path: string): {
  type: "stone" | "flow-session" | "flow-detail" | "flow-ui" | "process-json" | "file";
  objectName?: string;
  sessionId?: string;
  ext?: string;
} {
  /* stones/{objectId} — 目录级别 */
  const stoneMatch = path.match(/^stones\/([^/]+)$/);
  if (stoneMatch) return { type: "stone", objectName: stoneMatch[1] };

  /* stones/{objectId}/readme.md — 也指向 StoneView */
  const stoneReadmeMatch = path.match(/^stones\/([^/]+)\/readme\.md$/);
  if (stoneReadmeMatch) return { type: "stone", objectName: stoneReadmeMatch[1] };

  /* flows/{sessionId}/flows/{objectName}/shared/ui — Flow 自渲染 UI */
  const flowUIMatch = path.match(/^flows\/([^/]+)\/flows\/([^/]+)\/shared\/ui$/);
  if (flowUIMatch) return { type: "flow-ui", sessionId: flowUIMatch[1], objectName: flowUIMatch[2] };

  /* process.json 特殊处理：任何路径下的 process.json 都用 ProcessView */
  if (path.endsWith("/process.json")) {
    return { type: "process-json" };
  }

  /* flows/{sessionId}/flows/{objectId} — sub-flow 目录 */
  const subFlowMatch = path.match(/^flows\/([^/]+)\/flows\/([^/]+)$/);
  if (subFlowMatch) {
    const objectName = subFlowMatch[2]!;
    return { type: "flow-detail", sessionId: subFlowMatch[1], objectName };
  }

  /* flows/{sessionId}/{objectId} — 旧结构兼容 */
  const oldSubFlowMatch = path.match(/^flows\/([^/]+)\/([^/]+)$/);
  if (oldSubFlowMatch) {
    const child = oldSubFlowMatch[2]!;
    /* 如果是文件（有扩展名），走 file 路由 */
    if (child.includes(".")) {
      const ext = child.split(".").pop()!.toLowerCase();
      return { type: "file", ext };
    }
    return { type: "flow-detail", sessionId: oldSubFlowMatch[1], objectName: child };
  }

  /* flows/{sessionId} — session 级别 */
  const flowMatch = path.match(/^flows\/([^/]+)$/);
  if (flowMatch) return { type: "flow-session", sessionId: flowMatch[1] };

  /* 文件 */
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return { type: "file", ext };
}

export function ViewRouter({ filePath }: ViewRouterProps) {
  const route = parseRoute(filePath);

  if (route.type === "stone" && route.objectName) {
    const name = route.objectName;
    if (hasCustomUI(name)) {
      const stoneUIProps: StoneUIProps = {
        stone: { name, whoAmI: "", data: {} },
        sendMessage: (msg: string) => { talkTo(name, msg).catch(console.error); },
      };
      return (
        <DynamicUI
          importPath={`@stones/${name}/shared/ui/index.tsx`}
          componentProps={stoneUIProps}
          fallback={<ObjectDetail objectName={name} />}
        />
      );
    }
    return <ObjectDetail objectName={name} />;
  }

  if (route.type === "flow-detail" && route.sessionId && route.objectName) {
    return <FlowView sessionId={route.sessionId} objectName={route.objectName} />;
  }

  if (route.type === "flow-ui" && route.sessionId && route.objectName) {
    const flowImportPath = `@flows/${route.sessionId}/flows/${route.objectName}/shared/ui/index.tsx`;
    return (
      <DynamicUI
        importPath={flowImportPath}
        componentProps={{ sessionId: route.sessionId, objectName: route.objectName }}
        fallback={
          <div className="flex items-center justify-center h-full text-sm text-[var(--muted-foreground)]">
            该对象尚未生成自渲染 UI
          </div>
        }
      />
    );
  }

  if (route.type === "flow-session" && route.sessionId) {
    return <ChatPage />;
  }

  if (route.type === "process-json") {
    return <ProcessJsonView filePath={filePath} />;
  }

  /* 文件内容查看 */
  return <FileContentView filePath={filePath} ext={route.ext ?? ""} />;
}

function FileContentView({ filePath, ext }: { filePath: string; ext: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    setContent(null);
    setError(null);
    fetchFileContent(filePath)
      .then(setContent)
      .catch((e) => setError(e.message));
  }, [filePath, refreshKey]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
      </div>
    );
  }

  /* JSON */
  if (ext === "json") {
    let formatted = content;
    try {
      formatted = JSON.stringify(JSON.parse(content), null, 2);
    } catch { /* 保持原文 */ }
    return (
      <div className="h-full overflow-auto">
        <CodeMirrorViewer content={formatted} ext="json" />
      </div>
    );
  }

  /* Markdown */
  if (ext === "md") {
    return (
      <div className="p-4 sm:p-8 overflow-auto h-full prose prose-sm max-w-none">
        <MarkdownContent content={content} />
      </div>
    );
  }

  /* 图片 */
  if (/^(png|jpg|jpeg|gif|svg|webp)$/.test(ext)) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-sm text-[var(--muted-foreground)]">图片预览暂不支持</p>
      </div>
    );
  }

  /* 代码 / 纯文本 — CodeMirror 展示 */
  return (
    <div className="h-full overflow-auto">
      <CodeMirrorViewer content={content} ext={ext} />
    </div>
  );
}

/** process.json 专用查看器 — 用 ProcessView 渲染 */
function ProcessJsonView({ filePath }: { filePath: string }) {
  const [process, setProcess] = useState<Process | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshKey = useAtomValue(refreshKeyAtom);

  useEffect(() => {
    setProcess(null);
    setError(null);
    fetchFileContent(filePath)
      .then((content) => {
        const parsed = JSON.parse(content) as Process;
        setProcess(parsed);
      })
      .catch((e) => setError(e.message));
  }, [filePath, refreshKey]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!process) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <ProcessView process={process} />
    </div>
  );
}
