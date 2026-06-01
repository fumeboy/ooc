import type { SkillIndexWindow } from "../types.js";
import React from "react";

/** Skill index window 详情面板:按 scope 分组。 */
export default function SkillIndexWindowDetail({ window }: { window: SkillIndexWindow }) {
  const groups: Array<{ scope: "object" | "workspace" | "external"; label: string; skills: typeof window.skills }> = [
    { scope: "object", label: "object", skills: window.skills.filter((s) => s.scope === "object") },
    { scope: "workspace", label: "workspace", skills: window.skills.filter((s) => s.scope === "workspace") },
    { scope: "external", label: "external", skills: window.skills.filter((s) => s.scope === "external") },
  ];
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">total</span>
          <span className="llm-input-attr-value">
            {window.skills.length} skill{window.skills.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="cw-skill-groups">
        {groups.map((g) => {
          if (g.skills.length === 0) return null;
          return (
            <div key={g.scope} className="cw-skill-group">
              <div className="cw-skill-group-head">
                <span className="cw-skill-scope-badge" data-scope={g.scope}>{g.label}</span>
                <span className="cw-skill-count muted small">{g.skills.length}</span>
              </div>
              <ul className="cw-skill-list">
                {g.skills.map((s) => (
                  <li key={`${g.scope}:${s.name}`} className="cw-skill-item" title={s.skillFilePath}>
                    <div className="cw-skill-item-head">
                      <span className="cw-skill-name">{s.name}</span>
                      <span className="cw-skill-path muted small">{s.skillFilePath}</span>
                    </div>
                    <div className="cw-skill-desc">{s.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {window.skills.length === 0 && (
          <div className="llm-input-empty">该 thread 当前未挂载任何 skill。</div>
        )}
      </div>
    </>
  );
}

export { SkillIndexWindowDetail as WindowDetail };
