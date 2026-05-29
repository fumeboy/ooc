/**
 * StoneDetailView — faithful port of ooc-2 stone detail visual style.
 * Shows self.md / readme.md / server-source tabs + call-method form.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Code, RefreshCw, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getStone,
  getStoneSelf,
  getStoneReadme,
  getStoneServerSource,
  callStoneMethod,
  type StoneDetail,
} from "../api";

type ActiveSection = "self" | "readme" | "server";

export function StoneDetailView() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [stone, setStone] = useState<StoneDetail | null>(null);
  const [selfContent, setSelfContent] = useState<string | null>(null);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [serverContent, setServerContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activeSection, setActiveSection] = useState<ActiveSection>("self");
  const [methodName, setMethodName] = useState("");
  const [methodArgs, setMethodArgs] = useState("{}");
  const [methodResult, setMethodResult] = useState<string | undefined>();
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | undefined>();

  async function load() {
    if (!name) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await getStone("main", name);
      setStone(res);
      // The detail endpoint already includes self and readme
      setSelfContent(res.self ?? null);
      setReadmeContent(res.readme ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadServerSource() {
    if (!name || serverContent !== null) return;
    try {
      const res = await getStoneServerSource("main", name);
      setServerContent(res.content);
    } catch {
      setServerContent("// Server source not available");
    }
  }

  useEffect(() => { void load(); }, [name]);

  useEffect(() => {
    if (activeSection === "server") void loadServerSource();
  }, [activeSection]);

  async function handleCallMethod() {
    if (!stone || !methodName.trim()) return;
    setCalling(true);
    setCallError(undefined);
    setMethodResult(undefined);
    let args: unknown = {};
    try {
      args = JSON.parse(methodArgs);
    } catch {
      setCallError("Invalid JSON in args");
      setCalling(false);
      return;
    }
    try {
      const res = await callStoneMethod("main", stone.name, { method: methodName.trim(), args });
      setMethodResult(JSON.stringify(res.result, null, 2));
    } catch (e) {
      setCallError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  }

  if (loading) return (
    <>
      <div className="header">
        <button className="btn" style={{ padding: "5px 8px" }} onClick={() => navigate("/stones")}>
          <ArrowLeft size={14} />
        </button>
        <div className="header-title">Loading…</div>
      </div>
      <div className="main-body"><div className="empty">Loading stone details…</div></div>
    </>
  );

  if (error || !stone) return (
    <>
      <div className="header">
        <button className="btn" style={{ padding: "5px 8px" }} onClick={() => navigate("/stones")}>
          <ArrowLeft size={14} />
        </button>
        <div className="header-title">Error</div>
      </div>
      <div className="main-body"><div className="error">{error ?? "Stone not found"}</div></div>
    </>
  );

  const sections: Array<{ id: ActiveSection; label: string; available: boolean }> = [
    { id: "self", label: "self.md", available: Boolean(selfContent) },
    { id: "readme", label: "readme.md", available: Boolean(readmeContent) },
    { id: "server", label: "server", available: stone.hasServer },
  ];

  return (
    <>
      <div className="header">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <button className="btn" style={{ padding: "5px 8px" }} onClick={() => navigate("/stones")}>
            <ArrowLeft size={14} />
          </button>
          <div>
            <div className="header-title">{name}</div>
            <div className="muted small row" style={{ gap: 6 }}>
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>{stone.uri}</span>
              {stone.hasServer && <span className="pill" style={{ fontSize: 10 }}>server</span>}
              {stone.hasClient && <span className="pill" style={{ fontSize: 10 }}>client</span>}
            </div>
          </div>
        </div>
        <button className="btn btn-sm" onClick={load}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Section tabs */}
      <div className="content-tabs">
        {sections.filter((s) => s.available).map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn btn-sm${activeSection === s.id ? " primary" : ""}`}
            onClick={() => setActiveSection(s.id)}
          >
            {s.id === "server" && <Code size={11} />}
            {s.label}
          </button>
        ))}
      </div>

      <div className="main-body">
        {/* self.md */}
        {activeSection === "self" && selfContent && (
          <div className="stone-fallback-section-body">
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selfContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* readme.md */}
        {activeSection === "readme" && readmeContent && (
          <div className="stone-fallback-section-body">
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{readmeContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* server source */}
        {activeSection === "server" && stone.hasServer && (
          <div className="stone-fallback-section-body">
            {serverContent !== null ? (
              <pre style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 12,
                lineHeight: 1.58,
                background: "rgba(246,247,244,.95)",
                border: "1px solid rgba(224,227,220,.92)",
                borderRadius: 10,
                padding: "10px 12px",
              }}>{serverContent}</pre>
            ) : (
              <div className="muted small">Loading server source…</div>
            )}
          </div>
        )}

        {/* Call method form */}
        {stone.hasServer && (
          <div style={{ marginTop: 20 }}>
            <div className="section">
              <div className="row" style={{ marginBottom: 10 }}>
                <Terminal size={13} />
                <strong style={{ fontSize: 12 }}>Invoke Method</strong>
              </div>
              <div className="stack">
                <label className="field-label">
                  Method name
                  <input
                    className="input"
                    value={methodName}
                    onChange={(e) => setMethodName(e.target.value)}
                    placeholder="myMethod"
                  />
                </label>
                <label className="field-label">
                  Args (JSON)
                  <textarea
                    className="textarea"
                    value={methodArgs}
                    onChange={(e) => setMethodArgs(e.target.value)}
                    style={{ fontFamily: "monospace", fontSize: 12, minHeight: 60 }}
                  />
                </label>
                <div>
                  <button
                    className="btn btn-sm primary"
                    onClick={handleCallMethod}
                    disabled={calling || !methodName.trim()}
                  >
                    {calling ? "Calling…" : "Invoke"}
                  </button>
                </div>
                {callError && <div className="error">{callError}</div>}
                {methodResult !== undefined && (
                  <div>
                    <div className="section-title" style={{ marginBottom: 6 }}>Result</div>
                    <pre style={{
                      margin: 0, padding: "10px 12px",
                      background: "rgba(246,247,244,.95)",
                      border: "1px solid rgba(224,227,220,.92)",
                      borderRadius: 8,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                      fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word",
                      maxHeight: 400, overflow: "auto",
                    }}>{methodResult}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
