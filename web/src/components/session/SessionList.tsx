// Session 列表组件。
import type { SessionListItem } from '../../types/api'
import LoadingSpinner from '../common/LoadingSpinner'

interface Props {
  sessions: SessionListItem[]
  selectedSessionId: string | null
  onSelect: (id: string) => void
  loading: boolean
  onRefresh: () => void
  variant?: 'panel' | 'hero'
}

export default function SessionList({
  sessions,
  selectedSessionId,
  onSelect,
  loading,
  onRefresh,
  variant = 'panel',
}: Props) {
  const deduped = Array.from(new Map(sessions.map((s) => [s.id, s])).values())
  const isHero = variant === 'hero'
  return (
    <div
      className={isHero ? 'glass' : 'card'}
      style={
        isHero
          ? {
              padding: '14px',
              borderRadius: '14px',
              border: '1px solid var(--border-color)',
              boxShadow: '0 16px 50px rgba(0,0,0,0.06)',
              background: 'linear-gradient(160deg, rgba(255,255,255,0.92), rgba(243,246,255,0.9))',
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Session 列表</h3>
        <div className="flex items-center gap-2">
            <LoadingSpinner loading={loading} />
            <button className="btn-secondary text-sm" onClick={onRefresh} disabled={loading}>
            刷新
            </button>
        </div>
      </div>
      <div className="scroll-area" style={{ maxHeight: isHero ? '360px' : '320px' }}>
        {deduped.map((session) => {
          const active = selectedSessionId === session.id
          return (
            <div
              key={session.id}
              className="p-3 mb-2 rounded-lg cursor-pointer"
              onClick={() => onSelect(session.id)}
              style={{
                background: active
                  ? 'linear-gradient(120deg, rgba(56,104,170,0.14), rgba(56,104,170,0.08))'
                  : isHero
                  ? 'rgba(255,255,255,0.66)'
                  : 'transparent',
                border: active ? '1px solid rgba(56,104,170,0.4)' : '1px solid var(--border-color)',
                boxShadow: active ? '0 8px 20px rgba(56,104,170,0.12)' : undefined,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{session.id}</div>
                <span
                  className="text-xs px-2 py-1 rounded bg-slate-200"
                  style={{ background: active ? 'rgba(56,104,170,0.15)' : 'rgba(0,0,0,0.05)' }}
                >
                  {session.status}
                </span>
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

