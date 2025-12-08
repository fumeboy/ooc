// Conversation 详情视图。
import { useAtom } from 'jotai'
import { useCallback, useState } from 'react'
import Tag from '../common/Tag'
import { conversationDetailsAtom } from '../../atoms'
import { getConversation } from '../../api/client'
import ReferenceList from '../info/ReferenceList'
import ManualThinkResponder from './ManualThinkResponder'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'

interface Props {
  sessionId: string
  conversationId: string
  onClose: () => void
}

const statusColor: Record<string, string> = {
  running: '#2563eb',
  waiting_answer: '#eab308',
  waiting_respond: '#8b5cf6',
  waiting_manual_think: '#f97316',
  completed: '#16a34a',
  error: '#ef4444',
}

export default function ConversationDetailTab({ sessionId, conversationId, onClose }: Props) {
  const [detailMap, setDetailMap] = useAtom(conversationDetailsAtom)
  const [loading, setLoading] = useState(false)
  const detail = detailMap[conversationId]

  const refresh = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await getConversation(sessionId, conversationId)
      setDetailMap((prev) => ({ ...prev, [conversationId]: res }))
    } finally {
      setLoading(false)
    }
  }, [sessionId, conversationId, setDetailMap])

  useAutoRefresh(refresh, 2000, Boolean(sessionId))

  if (!detail) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold">对话详情</h4>
          <button className="btn-secondary text-xs" onClick={onClose}>
            关闭
          </button>
        </div>
        {loading ? '加载中...' : '暂无数据'}
      </div>
    )
  }

  const statusBg = `${statusColor[detail.status] || '#6b7280'}22`
  const statusBorder = `${statusColor[detail.status] || '#6b7280'}55`
  const statusText = statusColor[detail.status] || '#374151'

  return (
    <div className="flex flex-1 flex-col gap-2  scroll-area">
      <div className="flex items-start justify-between px-1 gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <Tag>ID: {detail.id}</Tag>
            <Tag>From: {detail.from}</Tag>
            <Tag>To: {detail.to}</Tag>
            <Tag bg={statusBg} border={statusBorder} color={statusText}>
              状态: {detail.status}
            </Tag>
          </div>
          {detail.title && <div className="font-semibold text-sm mt-1">{detail.title}</div>}
        </div>
      </div>

      <div className="card">
        <div className="text-xs text-slate-500 font-bold pb-1">Request</div>
        <div className="text-sm whitespace-pre-wrap">{detail.request.content}</div>
        {detail.request.references && Object.keys(detail.request.references).length > 0 && (
          <ReferenceList references={detail.request.references} />
        )}
      </div>

      <div className="card">
        <div className="text-xs text-slate-500 font-bold pb-1">Response</div>
        <div className="text-sm whitespace-pre-wrap">{detail.response.content}</div>
        {detail.response.references && Object.keys(detail.response.references).length > 0 && (
          <ReferenceList references={detail.response.references} />
        )}
      </div>

      {detail.questions.length > 0 && (
        <div className="card">
          <div className="font-semibold mb-1">Questions</div>
          {detail.questions.map((q) => (
            <div key={q.id} className="mb-2">
              <div className="text-xs text-slate-500">Q{q.id}</div>
              <div className="text-sm whitespace-pre-wrap">{q.question.content}</div>
              {q.answer.content && (
                <div className="text-xs text-slate-500 mt-1">Answer: {q.answer.content}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {detail.activities.length > 0 && (
        <div className="card">
          <div className="font-semibold mb-1">Activities</div>
          {detail.activities.map((a, idx) => {
            const question =
              a.typ === 'ask' && a.question_id
                ? detail.questions.find((q) => q.id === a.question_id)
                : undefined
            return (
              <div key={`${a.typ}-${idx}`} className="text-sm border-b border-slate-100 py-1">
                {a.typ === 'talk' && <div>Talk → {a.conversation_id}</div>}
                {a.typ === 'focus' && <div>Focus → {a.conversation_id}</div>}
                {a.typ === 'act' && (
                  <div>
                    <div>
                      Act {a.object}::{a.method}
                    </div>
                    <div className="text-xs text-slate-500 whitespace-pre-wrap">{JSON.stringify(a.request, null, 2)}</div>
                    <div className="text-xs text-slate-500 whitespace-pre-wrap">{a.response?.content}</div>
                  </div>
                )}
                {a.typ === 'ask' && (
                  <div>
                    <div>Ask Q{a.question_id}</div>
                    {question && <div className="text-xs text-slate-500 whitespace-pre-wrap">{question.question.content}</div>}
                    {question?.answer?.content && (
                      <div className="text-xs text-emerald-600 whitespace-pre-wrap">Answer: {question.answer.content}</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ManualThinkResponder sessionId={sessionId} conversation={detail} onSubmitted={refresh} />
    </div>
  )
}

