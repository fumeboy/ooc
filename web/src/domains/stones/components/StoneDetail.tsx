/**
 * StoneDetail — shows self.md + readme.md (markdown rendered) + server source (code view).
 * "Call method" form: pick method, enter JSON args, POST call-method, show result.
 *
 * ooc-3 endpoints:
 *   GET /api/stones/:branch/:name           — stone detail (hasServer, hasClient)
 *   GET /api/stones/:branch/:name/self      — { ok, content }
 *   GET /api/stones/:branch/:name/readme    — { ok, content }
 *   GET /api/stones/:branch/:name/server-source  — { ok, content }
 *   POST /api/stones/:branch/:name/call-method   — { ok, result }
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Code, RefreshCw, Terminal } from "lucide-react";
import { MarkdownContent } from "../../../shared/ui/MarkdownContent";
import { requestJson } from "../../../transport/http";
import { endpoints } from "../../../transport/endpoints";

type Section = "self" | "readme" | "server";

interface StoneDetailData {
  name: string;
  uri: string;
  branch: string;
  hasServer: boolean;
  hasClient: boolean;
  self?: string;
  readme?: string;
}

export function StoneDetail({ name, branch = "main" }: { name: string; branch?: string }) {
  const navigate = useNavigate();
  const [stone, setStone] = useState<StoneDetailData | null>(null);
  const [serverContent, setServerContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activeSection, setActiveSection] = useState<Section>("self");
  const [methodName, setMethodName] = useState("");
  const [methodArgs, setMethodArgs] = useState("{}");
  const [methodResult, setMethodResult] = useState<string | undefined>();
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | undefined>();

  async function load() {
    setLoading(true);
    setError(undefined);
    try {
      const res = await requestJson<{
        ok: boolean;
        name: string;
        uri: string;
        branch: string;
        hasServer: boolean;
        hasClient: boolean;
        self?: string;
        readme?: string;
      }>(endpoints.stoneDetail(branch, name));
      setStone({
        name: res.name,
        uri: res.uri,
        branch: res.branch,
        hasServer: res.hasServer,
        hasClient: res.hasClient,
        self: res.self,
        readme: res.readme,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadServerSource() {
    if (!name || serverContent !== null) return;
    try {
      const res = await requestJson<{ ok: boolean; content: string }>(
        `/api/stones/${encodeURIComponent(branch)}/${encodeURIComponent(name)}/server-source`,
      );
      setServerContent(res.content ?? "");
    } catch {
      setServerContent("// Server source not available");
    }
  }

  useEffect(() => { void load(); }, [name, branch]);

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
      const res = await requestJson<{ ok: boolean; result: unknown }>(
        endpoints.stoneCallMethod(branch, name),
        {
          method: "POST",
          body: JSON.stringify({ method: methodName.trim(), args }),
        },
      );
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

  const sections: Array<{ id: Section; label: string; available: boolean }> = [
    { id: "self", label: "self.md", available: Boolean(stone.self) },
    { id: "readme", label: "readme.md", available: Boolean(stone.readme) },
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
            <div className="header-title">{stone.name}</div>
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
        {activeSection === "self" && stone.self && (
          <div className="stone-fallback-section-body">
            <MarkdownContent content={stone.self} />
          </div>
        )}

        {activeSection === "readme" && stone.readme && (
          <div className="stone-fallback-section-body">
            <MarkdownContent content={stone.readme} />
          </div>
        )}

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
