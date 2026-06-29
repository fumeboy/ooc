import { useLocation } from "react-router";
import { SessionCreator } from "../../domains/sessions/components/SessionCreator";
import type { Stone } from "../../domains/stones";
import { Card } from "../../shared/ui/card";
import { GlossaryLink } from "../../shared/ui/Glossary";

export function Welcome({
  stones,
  onCreateSession,
}: {
  stones: Stone[];
  onCreateSession?: (input: { sessionId: string; targetObjectId: string; initialMessage: string }) => Promise<void>;
}) {
  // 来自 UserThreadHome 的"Seed via welcome"按钮会带 `?session=<sid>`
  // query;读出来透给 SessionCreator 预填,用户不必复制粘贴 sessionId。
  const location = useLocation();
  const prefillSessionId = (() => {
    try {
      const qs = location.search.startsWith("?") ? location.search.slice(1) : location.search;
      const params = new URLSearchParams(qs);
      const sid = params.get("session");
      return sid ?? undefined;
    } catch {
      return undefined;
    }
  })();
  return (
    <div className="welcome-shell">
      <div className="welcome-stack">
        <div className="welcome-hero">
          <strong className="welcome-title">欢迎</strong>
          <div className="welcome-copy">
            创建你的第一个 session，或从左侧边栏选一个继续。
          </div>
          <GlossaryLink className="welcome-glossary-link" />
        </div>

        <Card className="welcome-card">
          <div className="welcome-card-head">
            <strong>创建 session</strong>
            <div className="muted small">
              选择想对话的 object 并输入第一条消息，我们会为你开启一个新 session。
            </div>
          </div>
          {onCreateSession && (
            <SessionCreator
              stones={stones}
              onCreate={onCreateSession}
              initialSessionId={prefillSessionId}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
