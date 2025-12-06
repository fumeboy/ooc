import type { SessionListItem } from '../types/api'

interface SessionListProps {
  sessions: SessionListItem[]
  selectedSessionId: string | null
  onSelect: (id: string) => void
  loading: boolean
  onRefresh: () => void
}

export default function SessionList({
  sessions,
  selectedSessionId,
  onSelect,
  loading,
  onRefresh,
}: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list-header">
        <h3>历史 Session</h3>
        <button onClick={onRefresh} disabled={loading} className="refresh-button">
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="session-list-content">
        {sessions.length === 0 ? (
          <div className="session-list-empty">
            <p>暂无 Session</p>
          </div>
        ) : (
          <ul className="session-list-items">
            {sessions.map((session) => (
              <li
                key={session.id}
                className={`session-list-item ${
                  selectedSessionId === session.id ? 'selected' : ''
                }`}
                onClick={() => onSelect(session.id)}
              >
                <div className="session-list-item-header">
                  <span className="session-list-item-id">{session.id}</span>
                  <span className={`session-list-item-status status-${session.status}`}>
                    {session.status}
                  </span>
                </div>
                <div className="session-list-item-content">
                  <p className="session-list-item-request">{session.user_request}</p>
                  <div className="session-list-item-meta">
                    <span>{new Date(session.created_at).toLocaleString('zh-CN')}</span>
                    {session.possessed && (
                      <span className="session-list-item-possessed">附身中</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

