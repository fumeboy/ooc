/**
 * StoneFallback — 当一个 stone 没有自定义 `client/index.tsx`(或加载失败)时,
 * 替代原 "信息待产出..." 死区, 把已有的 self.md / readme.md / knowledge / 入口
 * 拼成一张"Object 名片", 让用户立刻看到这个 stone 是谁、能做什么。
 *
 * 设计哲学 (Supervisor): OOC stone 不是一段空 React 组件, 而是一个"有身份 / 有公开
 * 介绍 / 有持续记忆 / 可被对话和探索"的实体。fallback 必须把这层语义传达出来。
 *
 * 数据来源 (没有任何新增 backend):
 *   - `GET /api/stones/<id>/self`         → 身份 (self.md)
 *   - `GET /api/stones/<id>/readme`       → 公开介绍 (readme.md)
 *   - `GET /api/tree?scope=stones&path=<id>/knowledge` → 持续记忆目录概览 (children + 文件数)
 *   - `GET /api/flows`                    → 最近 session, 与 sessionThreads 交叉过滤
 *
 * 触发条件: ObjectClientRenderer 在 stone scope 且文件不存在 / load 抛错 / default
 * export 缺失时, 用本组件替代 NotProducedYet / LoadErrorBox。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { MarkdownContent } from "../../shared/ui/MarkdownContent";
import { requestJson } from "../../transport/http";
import { fetchTree } from "../files/query";
import { endpoints } from "../../transport/endpoints";
import type { FileTreeNode } from "../files/model";
import { useDisplayName } from "../objects";

interface StoneFallbackProps {
  objectId: string;
  /** load 失败时把原错误信息折叠在底部, 便于排查; 不存在 client 时省略。 */
  loadError?: { message: string; absPath: string };
}

type FlowSummary = { sessionId: string; title?: string; updatedAt?: number };

/**
 * Issue #5 Bad #2 fix: 上一轮 StoneFallback 在 stone 不存在(`/stones/nonexistent_xyz`)时
 * 仍然渲染完整 self/readme/knowledge 模板,让用户误以为 stone 存在。
 *
 * 修复策略: mount 时先 `GET /api/stones` 拉 list,根据 objectId 是否在列表里区分:
 *   - exists → 渲染原有 fallback (name card + self/readme/knowledge/entries)
 *   - !exists → 显示 "Stone not found" 卡片 + 返回 stones 列表的链接,**不**渲染空模板
 *
 * 不增加新 backend (现有 `/api/stones` 已能 cheap 判存在; per-stone GET 即使对
 * nonexistent 也返回 200 + `exists:true`,不可信)。
 */
type ExistenceState =
  | { loading: true }
  | { loading: false; exists: true }
  | { loading: false; exists: false };

function useStoneExists(objectId: string): ExistenceState {
  const [state, setState] = useState<ExistenceState>({ loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    requestJson<{ items?: { objectId: string }[] }>(endpoints.stones)
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        const exists = items.some((s) => s.objectId === objectId);
        setState({ loading: false, exists });
      })
      .catch(() => {
        if (cancelled) return;
        // 网络错误时默认按 exists 处理 — 至少让用户能看到 fallback 内容,
        // 而不是被一个误导的 "not found" 卡住。
        setState({ loading: false, exists: true });
      });
    return () => {
      cancelled = true;
    };
  }, [objectId]);
  return state;
}

export function StoneFallback({ objectId, loadError }: StoneFallbackProps) {
  const existence = useStoneExists(objectId);

  if (!existence.loading && !existence.exists) {
    return <StoneNotFoundCard objectId={objectId} />;
  }
  if (existence.loading) {
    return (
      <div className="stone-fallback" data-testid="stone-fallback-loading">
        <p className="muted small" style={{ padding: 24 }}>加载中...</p>
      </div>
    );
  }
  return <StoneFallbackBody objectId={objectId} loadError={loadError} />;
}

function StoneNotFoundCard({ objectId }: { objectId: string }) {
  return (
    <div className="stone-fallback" data-testid="stone-not-found">
      <header className="stone-fallback-header">
        <h1 className="stone-fallback-title">Stone not found</h1>
        <code className="stone-fallback-id" title={objectId}>{objectId}</code>
        <p className="stone-fallback-tagline muted small">
          没有找到 objectId 为 <code>{objectId}</code> 的 stone — 该 stone 可能已被删除,或 URL 拼写有误。
        </p>
      </header>
      <div className="stone-fallback-entries" style={{ marginTop: 24, maxWidth: 480 }}>
        <Link to="/stones" className="stone-fallback-entry" data-testid="stone-not-found-back">
          <span className="stone-fallback-entry-label">← Browse all stones / 查看全部 stones</span>
          <span className="muted small">/stones</span>
        </Link>
      </div>
    </div>
  );
}

function StoneFallbackBody({ objectId, loadError }: StoneFallbackProps) {
  const { displayName } = useDisplayName(objectId);
  const selfText = useStoneText(objectId, "self");
  const readmeText = useStoneText(objectId, "readme");
  const knowledge = useKnowledgeTree(objectId);
  const recentSessions = useRecentSessionsForStone(objectId);

  return (
    <div className="stone-fallback">
      <header className="stone-fallback-header">
        <h1 className="stone-fallback-title">{displayName || objectId}</h1>
        <code className="stone-fallback-id" title={objectId}>{objectId}</code>
        <p className="stone-fallback-tagline muted small">
          OOC stone — 一个有身份 (self.md) / 公开介绍 (readme.md) / 持续记忆 (knowledge) / 可被对话的实体。
        </p>
      </header>

      <div className="stone-fallback-grid">
        <main className="stone-fallback-main">
          <CollapsibleSection
            label="Identity / 身份"
            sourceHint={`stones/${objectId}/self.md`}
            defaultOpen
            loading={selfText.loading}
            empty={!selfText.loading && !selfText.text}
            emptyHint="self.md 为空 — 这个 stone 还没写下自己的身份。"
          >
            {selfText.text && <MarkdownContent content={selfText.text} />}
          </CollapsibleSection>

          <CollapsibleSection
            label="About / 介绍"
            sourceHint={`stones/${objectId}/readme.md`}
            defaultOpen
            loading={readmeText.loading}
            empty={!readmeText.loading && !readmeText.text}
            emptyHint="readme.md 为空 — 还没有面向其他 Object 的公开自我介绍。"
          >
            {readmeText.text && <MarkdownContent content={readmeText.text} />}
          </CollapsibleSection>

          <KnowledgeSummary objectId={objectId} state={knowledge} />
        </main>

        <aside className="stone-fallback-aside">
          <EntryList objectId={objectId} sessions={recentSessions} />
        </aside>
      </div>

      {loadError && (
        <details className="stone-fallback-error">
          <summary className="muted small">
            client/index.tsx 加载失败(展开查看) — 文件路径: <code>{loadError.absPath}</code>
          </summary>
          <pre className="stone-fallback-error-pre">{loadError.message}</pre>
        </details>
      )}
    </div>
  );
}

// ---------- sections ----------

interface CollapsibleSectionProps {
  label: string;
  sourceHint: string;
  defaultOpen?: boolean;
  loading?: boolean;
  empty?: boolean;
  emptyHint?: string;
  children?: React.ReactNode;
}

function CollapsibleSection({
  label,
  sourceHint,
  defaultOpen = true,
  loading,
  empty,
  emptyHint,
  children,
}: CollapsibleSectionProps) {
  return (
    <details className="stone-fallback-section" open={defaultOpen}>
      <summary className="stone-fallback-section-summary">
        <span className="stone-fallback-section-label">{label}</span>
        <code className="stone-fallback-section-source muted small">{sourceHint}</code>
      </summary>
      <div className="stone-fallback-section-body">
        {loading ? (
          <p className="muted small">加载中...</p>
        ) : empty ? (
          <p className="muted small">{emptyHint ?? "暂无内容。"}</p>
        ) : (
          children
        )}
      </div>
    </details>
  );
}

function KnowledgeSummary({
  objectId,
  state,
}: {
  objectId: string;
  state: KnowledgeState;
}) {
  return (
    <CollapsibleSection
      label="Knowledge / 持续记忆"
      // 根因 #3 (2026-05-24)：knowledge 在 pool 层，路径 pools/objects/<id>/knowledge/。
      sourceHint={`pools/objects/${objectId}/knowledge/`}
      defaultOpen
      loading={state.loading}
      empty={!state.loading && (state.error !== undefined || state.dirs.length === 0)}
      emptyHint={
        state.error
          ? `读取目录失败: ${state.error}`
          : "knowledge/ 下还没有任何子目录 — 这个 stone 还没沉淀过记忆。"
      }
    >
      <ul className="stone-fallback-knowledge-list">
        {state.dirs.map((entry) => (
          <li key={entry.name} className="stone-fallback-knowledge-item">
            <Link
              to={`/files/pools/objects/${objectId}/knowledge/${entry.name}`}
              className="stone-fallback-knowledge-name"
              data-testid={`knowledge-entry-${entry.name}`}
            >
              {entry.name}/
            </Link>
            <span className="muted small">
              {entry.fileCount} {entry.fileCount === 1 ? "file" : "files"}
              {entry.dirCount > 0 ? ` · ${entry.dirCount} dirs` : ""}
            </span>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}

function EntryList({
  objectId,
  sessions,
}: {
  objectId: string;
  sessions: RecentSessionsState;
}) {
  return (
    <div className="stone-fallback-entries">
      <h2 className="stone-fallback-entries-title">Entry points / 入口</h2>

      <Link
        to={`/files/stones/${objectId}`}
        className="stone-fallback-entry"
        data-testid="entry-view-source"
      >
        <span className="stone-fallback-entry-label">View source / 查看源文件</span>
        <span className="muted small">stones/{objectId}/</span>
      </Link>

      <Link
        to="/welcome"
        className="stone-fallback-entry"
        data-testid="entry-start-thread"
      >
        <span className="stone-fallback-entry-label">Start new thread / 跟它发起对话</span>
        <span className="muted small">welcome 页选择 {objectId} 作为 target object</span>
      </Link>

      <div className="stone-fallback-entry stone-fallback-entry-static" data-testid="entry-recent-flows">
        <span className="stone-fallback-entry-label">Recent flows / 最近 session</span>
        {sessions.loading ? (
          <span className="muted small">加载中...</span>
        ) : sessions.items.length === 0 ? (
          <span className="muted small">
            {sessions.error ?? "暂无 session 包含此 stone — 从上面 'Start new thread' 发起第一条对话。"}
          </span>
        ) : (
          <ul className="stone-fallback-recent-list">
            {sessions.items.map((s) => (
              <li key={s.sessionId}>
                <Link
                  to={`/flows/${encodeURIComponent(s.sessionId)}`}
                  className="stone-fallback-recent-link"
                  data-testid={`recent-session-${s.sessionId}`}
                  title={s.sessionId}
                >
                  {s.title || s.sessionId}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- hooks ----------

interface TextState { text: string; loading: boolean }

function useStoneText(objectId: string, kind: "self" | "readme"): TextState {
  const [state, setState] = useState<TextState>({ text: "", loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ text: "", loading: true });
    const url =
      kind === "self"
        ? `/api/stones/${encodeURIComponent(objectId)}/self`
        : `/api/stones/${encodeURIComponent(objectId)}/readme`;
    requestJson<{ text?: string }>(url)
      .then((res) => {
        if (cancelled) return;
        setState({ text: typeof res?.text === "string" ? res.text : "", loading: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ text: "", loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [objectId, kind]);
  return state;
}

interface KnowledgeEntry { name: string; fileCount: number; dirCount: number }
interface KnowledgeState { dirs: KnowledgeEntry[]; loading: boolean; error?: string }

function useKnowledgeTree(objectId: string): KnowledgeState {
  const [state, setState] = useState<KnowledgeState>({ dirs: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ dirs: [], loading: true });
    // 根因 #3 (2026-05-24): knowledge 在 pool 层，路径 pools/objects/<id>/knowledge/；
    // ui.tree 的 scopes 是 world|flows|stones，pools 走 world scope + path。
    fetchTree("world", `pools/objects/${objectId}/knowledge`)
      .then((node) => {
        if (cancelled) return;
        const dirs = summarizeKnowledge(node);
        setState({ dirs, loading: false });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ dirs: [], loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, [objectId]);
  return state;
}

function summarizeKnowledge(node: FileTreeNode): KnowledgeEntry[] {
  if (!node.children) return [];
  const dirs: KnowledgeEntry[] = [];
  for (const child of node.children) {
    if (child.type !== "directory") continue;
    const grand = child.children ?? [];
    const fileCount = grand.filter((c) => c.type === "file").length;
    const dirCount = grand.filter((c) => c.type === "directory").length;
    dirs.push({ name: child.name, fileCount, dirCount });
  }
  return dirs;
}

interface RecentSessionsState { items: FlowSummary[]; loading: boolean; error?: string }

function useRecentSessionsForStone(objectId: string): RecentSessionsState {
  const [state, setState] = useState<RecentSessionsState>({ items: [], loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ items: [], loading: true });
    (async () => {
      try {
        const flows = await requestJson<{ items?: FlowSummary[] }>(endpoints.flows);
        const items = Array.isArray(flows.items) ? flows.items : [];
        // 按 updatedAt 倒序 take 上限以控制并发, 避免拉太多 sessionThreads
        const sorted = [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
        const probe = sorted.slice(0, 12);
        const results = await Promise.all(
          probe.map(async (f) => {
            try {
              const tr = await requestJson<{ items?: { objectId: string }[] }>(
                endpoints.sessionThreads(f.sessionId),
              );
              const has = (tr.items ?? []).some((t) => t.objectId === objectId);
              return has ? f : null;
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const hits = results.filter((x): x is FlowSummary => x !== null).slice(0, 3);
        setState({ items: hits, loading: false });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ items: [], loading: false, error: `加载失败: ${msg}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectId]);
  return state;
}

// 默认 export 留空 — 这个文件不作为 ObjectClient 直接挂载, 仅作为命名 export
// 被 ObjectClientRenderer 在 stone fallback 分支引用。
