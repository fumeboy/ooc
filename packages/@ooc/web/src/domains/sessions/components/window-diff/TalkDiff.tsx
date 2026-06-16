/**
 * TalkDiff — talk_window 的 visible/diff 组件（线 C）。
 *
 * 逻辑来自 window-diff-renderers/TalkWindowDiff.tsx，
 * 签名收敛到 WindowDiffProps ({previous, current})，删去 windowId 引用。
 *
 * Diff 形态：
 *   - target / status / title 字段 diff（conversation id 恒等于窗实例 id，不再有 data 字段可 diff）
 *   - transcript（或 messages）消息级 diff，按 id 配对，退化按 index
 */

import type { WindowDiffProps } from "./window-diff-props";
import {
  FieldDiffLine,
  Section,
  StatusBadge,
  asRecord,
  comparePrimitive,
  readArray,
  readString,
  rowStyle,
  type DiffStatus,
} from "../window-diff-renderers/_shared";

type MessageLike = {
  id?: string;
  content?: string;
  from?: string;
  fromThreadId?: string;
  createdAt?: number;
};

function asMessage(v: unknown): MessageLike {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    id: typeof o.id === "string" ? o.id : undefined,
    content:
      typeof o.content === "string"
        ? o.content
        : typeof o.text === "string"
          ? (o.text as string)
          : undefined,
    from:
      typeof o.from === "string"
        ? o.from
        : typeof o.fromThreadId === "string"
          ? (o.fromThreadId as string)
          : undefined,
    createdAt: typeof o.createdAt === "number" ? o.createdAt : undefined,
  };
}

export default function TalkDiff({ previous, current }: WindowDiffProps) {
  const prev = asRecord(previous);
  const cur = asRecord(current);

  // ----- 头部字段级 diff -----
  const fields = (
    <Section title="fields" testId="talk-fields">
      <FieldDiffLine label="target" prev={readString(prev, "target")} cur={readString(cur, "target")} />
      <FieldDiffLine label="status" prev={readString(prev, "status")} cur={readString(cur, "status")} />
      <FieldDiffLine label="title" prev={readString(prev, "title")} cur={readString(cur, "title")} />
    </Section>
  );

  // ----- transcript diff（如附挂） -----
  // 优先按 transcript / messages 顺序找
  const prevTranscript = (readArray(prev, "transcript").length > 0
    ? readArray(prev, "transcript")
    : readArray(prev, "messages")
  ).map(asMessage);
  const curTranscript = (readArray(cur, "transcript").length > 0
    ? readArray(cur, "transcript")
    : readArray(cur, "messages")
  ).map(asMessage);

  const renderTranscriptDiff = () => {
    // 按 id 配对，无 id 退化到 index
    const prevById = new Map<string, MessageLike>();
    const prevIndexed: Array<{ index: number; msg: MessageLike }> = [];
    prevTranscript.forEach((m, i) => {
      if (m.id) prevById.set(m.id, m);
      prevIndexed.push({ index: i, msg: m });
    });
    const seenIds = new Set<string>();
    const seenIndexes = new Set<number>();

    const rows: React.ReactNode[] = [];

    curTranscript.forEach((m, i) => {
      let prevMatch: MessageLike | undefined;
      if (m.id && prevById.has(m.id)) {
        prevMatch = prevById.get(m.id);
        seenIds.add(m.id);
      } else if (!m.id && i < prevTranscript.length) {
        prevMatch = prevTranscript[i];
        seenIndexes.add(i);
      }
      const status: DiffStatus = prevMatch
        ? comparePrimitive(prevMatch.content, m.content)
        : "added";
      rows.push(
        <div key={`cur-${i}`} style={rowStyle(status)} data-diff-status={status}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <strong>{m.from ?? "(unknown)"}</strong>
            <span className="muted small">#{m.id ?? i}</span>
            <StatusBadge status={status} />
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{m.content ?? "(empty)"}</div>
          {status === "changed" && prevMatch && (
            <div className="muted small" style={{ marginTop: 4, opacity: 0.7 }}>
              prev: {prevMatch.content ?? "(empty)"}
            </div>
          )}
        </div>,
      );
    });

    // 没被配对的 prev → removed
    prevIndexed.forEach(({ index, msg }) => {
      if (msg.id && seenIds.has(msg.id)) return;
      if (!msg.id && seenIndexes.has(index)) return;
      rows.push(
        <div
          key={`prev-${index}`}
          style={rowStyle("removed")}
          data-diff-status="removed"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <strong>{msg.from ?? "(unknown)"}</strong>
            <span className="muted small">#{msg.id ?? index}</span>
            <StatusBadge status="removed" />
          </div>
          <div style={{ whiteSpace: "pre-wrap" }}>{msg.content ?? "(empty)"}</div>
        </div>,
      );
    });

    if (rows.length === 0) {
      return <div className="muted small">no transcript in snapshot</div>;
    }
    return <>{rows}</>;
  };

  return (
    <div data-testid="talk-window-diff">
      {fields}
      <Section title={`messages (${curTranscript.length} cur · ${prevTranscript.length} prev)`} testId="talk-msgs">
        {renderTranscriptDiff()}
      </Section>
    </div>
  );
}
