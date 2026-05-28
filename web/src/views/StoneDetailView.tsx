import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Code, RefreshCw, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getStone,
  callStoneMethod,
  type StoneDetail,
} from "../api";

export function StoneDetailView() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [stone, setStone] = useState<StoneDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activeSection, setActiveSection] = useState<"self" | "readme" | "server">("self");
  // Call-method state
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [name]);

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
      const res = await callStoneMethod("main", stone.name, {
        method: methodName.trim(),
        args,
      });
      setMethodResult(JSON.stringify(res.result, null, 2));
    } catch (e) {
      setCallError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="main-header">
          <button className="btn-icon" onClick={() => navigate("/stones")}><ArrowLeft size={15} /></button>
          <div className="main-title">Loading…</div>
        </div>
        <div className="loading">Loading stone details…</div>
      </>
    );
  }

  if (error || !stone) {
    return (
      <>
        <div className="main-header">
          <button className="btn-icon" onClick={() => navigate("/stones")}><ArrowLeft size={15} /></button>
          <div className="main-title">Error</div>
        </div>
        <div className="main-body">
          <div className="error-msg">{error ?? "Stone not found"}</div>
        </div>
      </>
    );
  }

  const sections: Array<{ id: "self" | "readme" | "server"; label: string; available: boolean }> = [
    { id: "self", label: "self.md", available: Boolean(stone.self) },
    { id: "readme", label: "readme.md", available: Boolean(stone.readme) },
    { id: "server", label: "server", available: stone.hasServer },
  ];

  return (
    <>
      <div className="main-header">
        <button className="btn-icon" onClick={() => navigate("/stones")}><ArrowLeft size={15} /></button>
        <div style={{ flex: 1 }}>
          <div className="main-title">{name}</div>
          <div className="main-subtitle row" style={{ gap: 6 }}>
            <span style={{ fontFamily: "monospace", fontSize: 11 }}>{stone.uri}</span>
            {stone.hasServer && <span className="pill" style={{ fontSize: 10 }}>server</span>}
            {stone.hasClient && <span className="pill" style={{ fontSize: 10 }}>client</span>}
          </div>
        </div>
        <button className="btn btn-sm" onClick={load}>
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Section tabs */}
      <div style={{ padding: "8px 14px 0", borderBottom: "1px solid var(--border)", display: "flex", gap: 4, flexShrink: 0 }}>
        {sections.filter((s) => s.available).map((s) => (
          <button
            key={s.id}
            className={`btn btn-sm${activeSection === s.id ? " primary" : ""}`}
            onClick={() => setActiveSection(s.id)}
            style={{ borderRadius: "6px 6px 0 0", borderBottom: activeSection === s.id ? "none" : undefined }}
          >
            {s.id === "server" ? <Code size={11} /> : null}
            {s.label}
          </button>
        ))}
      </div>

      <div className="main-body">
        {activeSection === "self" && stone.self && (
          <div className="detail-section">
            <div className="detail-section-title">self.md</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{stone.self}</ReactMarkdown>
            </div>
          </div>
        )}

        {activeSection === "readme" && stone.readme && (
          <div className="detail-section">
            <div className="detail-section-title">readme.md</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{stone.readme}</ReactMarkdown>
            </div>
          </div>
        )}

        {activeSection === "server" && stone.hasServer && (
          <div className="detail-section">
            <div className="detail-section-title">server/index.ts</div>
            <p className="muted small" style={{ marginBottom: 10 }}>
              Methods are loaded at runtime. Use the invoke form below to call them.
            </p>
          </div>
        )}

        {/* Call method form */}
        {stone.hasServer && (
          <div className="card">
            <div className="card-title row">
              <Terminal size={13} />
              Invoke Method
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
              {callError && <div className="error-msg">{callError}</div>}
              {methodResult !== undefined && (
                <div>
                  <div className="detail-section-title">Result</div>
                  <pre className="code-block">{methodResult}</pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
