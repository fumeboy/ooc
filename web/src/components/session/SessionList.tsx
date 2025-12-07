// Session 列表组件。
import type { SessionListItem } from '../../types/api'

interface Props {
  sessions: SessionListItem[]
  selectedSessionId: string | null
  onSelect: (id: string) => void
  loading: boolean
  onRefresh: () => void
}

export default function SessionList({ sessions, selectedSessionId, onSelect, loading, onRefresh }: Props) {
  const deduped = Array.from(new Map(sessions.map((s) => [s.id, s])).values())
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Session 列表</h3>
        <button className="btn-secondary text-sm" onClick={onRefresh} disabled={loading}>
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="scroll-area" style={{ maxHeight: '320px' }}>
        {deduped.map((session) => {
          const active = selectedSessionId === session.id
          return (
            <div
              key={session.id}
              className={`p-2 mb-2 rounded ${active ? 'bg-blue-100' : 'bg-transparent'} cursor-pointer`}
              onClick={() => onSelect(session.id)}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{session.id}</div>
                <span className="text-xs px-2 py-1 rounded bg-slate-200">{session.status}</span>
              </div>
              <div className="text-xs text-slate-600 mt-1">
                附身: {session.possessed ? '开' : '关'} 更新时间: {session.updated_at}
              </div>
            </div>
          )
        })}
        {deduped.length === 0 && <div className="text-sm text-slate-500">暂无 Session</div>}
      </div>
    </div>
  )
}

