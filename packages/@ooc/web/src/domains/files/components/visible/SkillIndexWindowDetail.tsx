/**
 * SkillIndexWindowDetail — skill_index window 详情面板(视觉体)。
 *
 * Phase 1: read-only 静态展示 skill_index window 的 skills 清单。
 * - attrs 区:skill count + scopes 分布(branch / object / external)
 * - skills 列表:table 风格(name / description / scope badge / skillFilePath)
 *
 * 签名统一为 `({ window }: { window: ContextWindow }) => JSX`,不带 callMethod。
 */
import React from "react";
import type { ContextWindow } from "../../context-snapshot";

type SkillIndexWindow = Extract<ContextWindow, { class: "skill_index" }>;

const FILE_PATH_LIMIT = 60;

function truncatePath(p: string, limit = FILE_PATH_LIMIT): string {
  if (p.length <= limit) return p;
  return `…${p.slice(p.length - (limit - 1))}`;
}

export default function SkillIndexWindowDetail({ window }: { window: ContextWindow }) {
  const w = window as SkillIndexWindow;
  const total = w.skills.length;
  const scopeCounts = { branch: 0, object: 0, external: 0 };
  for (const s of w.skills) scopeCounts[s.scope] += 1;
  return (
    <>
      <div className="llm-input-attrs">
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">skills</span>
          <span className="llm-input-attr-value">{total}</span>
        </div>
        <div className="llm-input-attr-row">
          <span className="llm-input-attr-key">scopes</span>
          <span className="llm-input-attr-value">
            branch {scopeCounts.branch} · object {scopeCounts.object} · external {scopeCounts.external}
          </span>
        </div>
      </div>
      {total === 0 ? (
        <div className="llm-input-empty">no skills indexed</div>
      ) : (
        <div className="llm-input-schema">
          <div className="llm-input-schema-title">Skills</div>
          <table className="llm-input-schema-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Scope</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {w.skills.map((s) => (
                <tr key={`${s.scope}:${s.skillFilePath}:${s.name}`} className="llm-input-schema-row">
                  <td className="llm-input-schema-name">
                    <code>{s.name}</code>
                  </td>
                  <td>{s.description}</td>
                  <td>
                    <span className="muted small">{s.scope}</span>
                  </td>
                  <td>
                    <code title={s.skillFilePath}>{truncatePath(s.skillFilePath)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
