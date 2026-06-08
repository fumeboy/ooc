/**
 * LLMInputJsonViewer — 渲染 thread debug 目录下的 llm.input.json / loop_NNN.input.json。
 *
 * 双视图（纯文本，无 context window 组件）：
 * - **JSON**（默认）：整个 llm.input.json 的原始文本（pretty-print）。
 * - **XML**：系统构造的第一条 message（role==="system"）的内容——它就是 system prompt，
 *   正文是 `<context>…` XML。单独抽出来作为 XML 视图。
 *
 * 右上角一个 JSON ⇄ XML 切换按钮；默认 JSON。无可用 system 文本时 XML 按钮 disable，
 * 视图固定停留在 JSON。
 */

import { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import type { FileContent } from "../model";

type ViewMode = "json" | "xml";

type LlmInputMessage = {
  type?: string;
  role?: string;
  content?: string;
};

type LlmInputDebugRecord = {
  threadId?: string;
  inputItems?: LlmInputMessage[];
};

function isLlmInputJsonPath(path: string): boolean {
  return /(^|\/)(llm|loop_\d+)\.input\.json$/.test(path);
}

/**
 * 抽取 system prompt 文本（XML 视图源）。
 *
 * 定位策略（稳健，避免硬编码到数组某一固定下标）：
 * 1. 数组第 0 条若是 message 且 role==="system" → 用它（最常见，系统构造的第一条）。
 * 2. 否则取第一条 role==="system" 的 message。
 * 3. 都没有 → undefined（XML 视图不可用）。
 */
function extractSystemPrompt(record: LlmInputDebugRecord | null): string | undefined {
  const items = record?.inputItems;
  if (!Array.isArray(items) || items.length === 0) return undefined;
  const isSystemMessage = (m: LlmInputMessage | undefined): m is LlmInputMessage =>
    Boolean(m) && m!.type === "message" && m!.role === "system" && typeof m!.content === "string";
  const first = items[0];
  if (isSystemMessage(first)) return first.content;
  const firstSystem = items.find(isSystemMessage);
  return firstSystem?.content;
}

/** 把原始 JSON 文本重新 pretty-print（解析失败时原样返回，仍可读）。 */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function LLMInputJsonViewer({ file }: { file: FileContent }) {
  const parsed = useMemo<LlmInputDebugRecord | null>(() => {
    try {
      return JSON.parse(file.content) as LlmInputDebugRecord;
    } catch {
      return null;
    }
  }, [file.content]);

  const jsonText = useMemo(() => prettyJson(file.content), [file.content]);
  const systemPrompt = useMemo(() => extractSystemPrompt(parsed), [parsed]);
  const xmlAvailable = typeof systemPrompt === "string" && systemPrompt.length > 0;

  const [mode, setMode] = useState<ViewMode>("json");
  // XML 不可用时强制回落 JSON（避免切到 XML 后数据变化导致空视图）。
  const effectiveMode: ViewMode = mode === "xml" && xmlAvailable ? "xml" : "json";

  const itemCount = Array.isArray(parsed?.inputItems) ? parsed!.inputItems!.length : undefined;

  return (
    <div className="llm-input-viewer">
      <div className="llm-input-header">
        <div>
          <div className="llm-input-title">LLM Input Viewer</div>
          <div className="llm-input-subtitle">
            {parsed?.threadId ? `thread: ${parsed.threadId}` : "raw llm.input.json"}
            {typeof itemCount === "number" ? ` · ${itemCount} items` : ""}
          </div>
        </div>
        <div className="llm-input-stats" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMode === "json"}
            className={`pill llm-input-view-toggle ${effectiveMode === "json" ? "is-active" : ""}`}
            onClick={() => setMode("json")}
          >
            JSON
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMode === "xml"}
            className={`pill llm-input-view-toggle ${effectiveMode === "xml" ? "is-active" : ""}`}
            onClick={() => setMode("xml")}
            disabled={!xmlAvailable}
            title={xmlAvailable ? "View system prompt (XML)" : "No system prompt in this file"}
          >
            XML
          </button>
        </div>
      </div>
      <div className="llm-input-text-body">
        {effectiveMode === "json" ? (
          <CodeMirror
            className="code-editor is-readonly"
            value={jsonText}
            editable={false}
            extensions={[jsonLanguage()]}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
          />
        ) : (
          // XML（system prompt）：codemirror 没装 @codemirror/lang-xml，用只读 <pre> 直出
          // 原始文本，避免新增依赖（bnpm lockfile 安装风险，见 MEMORY）。
          <pre className="llm-input-pre llm-input-xml">{systemPrompt ?? ""}</pre>
        )}
      </div>
    </div>
  );
}

export { isLlmInputJsonPath, extractSystemPrompt };
