// Conversation 摘要卡片。
import { FaComments, FaQuestionCircle } from 'react-icons/fa'
import { LuSearch } from 'react-icons/lu'
import Tag from '../common/Tag'
import type { ConversationResponse } from '../../types/api'

interface Props {
  sessionId: string
  conversation: ConversationResponse
  onViewDetail: (id: string) => void
  layout?: 'horizontal' | 'vertical'
}

const statusColor: Record<string, string> = {
  running: '#2563eb',
  waiting_answer: '#eab308',
  waiting_respond: '#8b5cf6',
  waiting_manual_think: '#f97316',
  completed: '#16a34a',
  error: '#ef4444',
}

export default function ConversationSummary({ sessionId, conversation, onViewDetail, layout = 'horizontal' }: Props) {
  const statusBg = `${statusColor[conversation.status] || '#6b7280'}22`
  const statusBorder = `${statusColor[conversation.status] || '#6b7280'}55`
  const statusText = statusColor[conversation.status] || '#374151'
  const unanswered = conversation.questions.some((q) => !q.answer?.content)
  const isVertical = layout === 'vertical'

  return (
    <div
      className="card mb-2 relative"
      style={{
        padding: '6px 10px',
        minHeight: '96px',
      }}
    >
      <div className="flex items-start justify-between px-1 gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="text-blue-500">
              <FaComments size={18} />
            </div>
            <Tag>ID: {conversation.id}</Tag>
            <Tag>From: {conversation.from}</Tag>
            <Tag>To: {conversation.to}</Tag>
            <Tag bg={statusBg} border={statusBorder} color={statusText}>
              状态: {conversation.status}
            </Tag>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-xs"
            style={{
              padding: '4px 8px',
              borderRadius: '10px',
              opacity: unanswered ? 1 : 0.4,
              borderColor: unanswered ? '#2563eb88' : undefined,
              color: unanswered ? '#2563eb' : undefined,
              cursor: unanswered ? 'pointer' : 'not-allowed',
            }}
            disabled={!unanswered}
            onClick={() => onViewDetail(conversation.id)}
            title={unanswered ? '存在未完成的问题' : '暂无待回答的问题'}
          >
            <FaQuestionCircle />
          </button>
          <button
            className="btn-secondary"
            style={{ padding: '6px 6px', borderRadius: '50%', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => onViewDetail(conversation.id)}
            aria-label="查看详情"
          >
            <LuSearch size={16} />
          </button>
        </div>
      </div>
      <div
        className="mt-2 text-xs"
        style={{
          background: '#f5f6f8',
          borderRadius: '8px',
          padding: '6px 8px',
          display: 'grid',
          gridTemplateColumns: isVertical ? '1fr' : '1fr 1fr',
          gap: '6px',
        }}
      >
        <div
          style={{
            borderRight: isVertical ? undefined : '1px solid var(--border-color)',
            borderBottom: isVertical ? '1px solid var(--border-color)' : undefined,
            paddingRight: isVertical ? 0 : '6px',
            paddingBottom: isVertical ? '6px' : 0,
            minHeight: isVertical ? '64px' : 'auto',
          }}
        >
          <div className="text-[11px] text-slate-500 font-bold">Request</div>
          <div className={isVertical ? 'whitespace-pre-wrap line-clamp-10' : 'whitespace-pre-wrap line-clamp-10'}>
            {conversation.request.content}
          </div>
        </div>
        <div style={{ minHeight: isVertical ? '64px' : 'auto' }}>
          <div className="text-[11px] text-slate-500 font-bold">Response</div>
          <div className={isVertical ? 'whitespace-pre-wrap line-clamp-10' : 'whitespace-pre-wrap line-clamp-10'}>
            {conversation.response.content}
          </div>
        </div>
      </div>
    </div>
  )
}

