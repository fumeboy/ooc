import { useMemo } from "react";
import { formatThread, type ThreadContext } from "..";
import { TuiBlock } from "./TuiBlock";

export function ThreadTimeline({ thread }: { thread?: ThreadContext }) {
  const lines = formatThread(thread);
  // 当前 thread.contextWindows 里仍存在的 window id 集合.
  // ChatPanel 用它判断 tool card 上的 link-btn 是否指向"仍可见"的 window —
  // form 在 submit 后会被 auto_removed, 此时 link 跳转会 fallback 到无关节点,
  // 用户体感"没反应" (用户反馈 2026-05-20). 让 TuiBlock 据此 disable / hide link.
  const liveWindowIds = useMemo(() => {
    const set = new Set<string>();
    for (const w of thread?.contextWindows ?? []) {
      if (w?.id) set.add(w.id);
    }
    return set;
  }, [thread?.contextWindows]);

  if (lines.length === 0) return <div className="muted small">No thread messages yet.</div>;
  return <div className="stack tui-thread">{lines.map((line) => <TuiBlock key={line.id} line={line} liveWindowIds={liveWindowIds} />)}</div>;
}
