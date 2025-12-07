// 等待手动处理的 Conversation 列表。
import { useAtom } from 'jotai'
import { useCallback, useState } from 'react'
import { selectedSessionIdAtom, sessionsAtom, waitingManualConversationsAtom } from '../../atoms'
import { getWaitingManualConversations, setPossess } from '../../api/client'
import ConversationSummary from './ConversationSummary'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'

interface Props {
  sessionId: string
  onViewDetail: (id: string) => void
}

export default function WaitingManualConversationsTab({ sessionId, onViewDetail }: Props) {
  const [waitingMap, setWaitingMap] = useAtom(waitingManualConversationsAtom)
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [, setSelectedSessionId] = useAtom(selectedSessionIdAtom)
  const [loading, setLoading] = useState(false)

  const items = waitingMap[sessionId] || []
  const currentSession = sessions.find((s) => s.id === sessionId)

  const refresh = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await getWaitingManualConversations(sessionId)
      setWaitingMap((prev) => ({ ...prev, [sessionId]: res.conversations }))
    } finally {
      setLoading(false)
    }
  }, [sessionId, setWaitingMap])

  useAutoRefresh(refresh, 2000, Boolean(sessionId))

  const togglePossess = async () => {
    if (!sessionId) return
    const next = !currentSession?.possessed
    await setPossess(sessionId, next)
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, possessed: next } : s)))
  }

  if (!sessionId) {
    return <div className="card">请先选择 Session</div>
  }

  return (
    <div className="flex flex-1 flex-col gap-2 scroll-area">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">等待手动处理</h4>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={() => setSelectedSessionId(sessionId)}>
            当前 Session
          </button>
          <button className="btn-secondary text-xs" onClick={togglePossess}>
            附身：{currentSession?.possessed ? '开' : '关'}
          </button>
          {loading && <span className="text-xs text-slate-500">刷新中</span>}
        </div>
      </div>
      <div className="scroll-area" style={{ maxHeight: '520px' }}>
        {items.map((conv) => (
          <ConversationSummary key={conv.id} sessionId={sessionId} conversation={conv} onViewDetail={onViewDetail} />
        ))}
        {items.length === 0 && <div className="card text-sm text-slate-500">暂无等待手动处理的对话</div>}
      </div>
    </div>
  )
}

