import { useState, useRef, useEffect, useMemo } from 'react'
import { conversationApi } from '../api/client'
import type { Conversation } from '../types/api'
import InfoReferenceSelector from './InfoReferenceSelector'
import ReferenceList from './ReferenceList'

interface ConversationSummaryProps {
  sessionId: string
  conversation: Conversation
  onViewDetail?: (conversationId: string) => void
  onRefresh?: () => void
}

function ConversationSummary({
  sessionId,
  conversation,
  onViewDetail,
  onRefresh,
}: ConversationSummaryProps) {
  const [answerContent, setAnswerContent] = useState('')
  const [answerReferences, setAnswerReferences] = useState<Record<string, string>>({})
  const [answering, setAnswering] = useState(false)
  
  // 使用 ref 来跟踪用户是否正在编辑，避免刷新时失去焦点
  const isEditingRef = useRef(false)
  const answerInputRef = useRef<HTMLTextAreaElement>(null)

  // 使用 useMemo 缓存计算结果，避免不必要的重新计算
  const unansweredQuestion = useMemo(
    () => conversation.questions.find((q) => !q.answer.content),
    [conversation.questions]
  )

  // 判断是否显示回复框：状态是 waiting_answer 且 from 是 user
  const showAnswerBox = useMemo(
    () => conversation.status === 'waiting_answer' && conversation.from === 'user::User',
    [conversation.status, conversation.from]
  )
  
  // 监听用户输入，标记为正在编辑
  useEffect(() => {
    if (answerContent) {
      isEditingRef.current = true
      const timer = setTimeout(() => {
        isEditingRef.current = false
      }, 1000) // 用户停止输入1秒后，允许刷新
      return () => clearTimeout(timer)
    } else {
      isEditingRef.current = false
    }
  }, [answerContent])

  const handleAnswer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!answerContent.trim() || !unansweredQuestion) return

    setAnswering(true)
    try {
      await conversationApi.answerAsk(sessionId, {
        conversation_id: conversation.id,
        question_id: unansweredQuestion.id,
        answer: answerContent,
        references: Object.keys(answerReferences).length > 0 ? answerReferences : undefined,
      })
      setAnswerContent('')
      setAnswerReferences({})
      if (onRefresh) {
        await onRefresh()
      }
    } catch (error) {
      console.error('Failed to answer question:', error)
      alert('回答失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setAnswering(false)
    }
  }

  return (
    <div className="conversation-summary">
      <div className="conversation-summary-header">
        <div className="conversation-summary-title">
          {conversation.title || conversation.id}
          {onViewDetail && (
            <button
              onClick={() => onViewDetail(conversation.id)}
              className="conversation-summary-view-detail"
              title="查看详情"
            >
              🔗
            </button>
          )}
        </div>
        <div className="conversation-summary-meta">
          <span className={`conversation-summary-status status-${conversation.status}`}>
            {conversation.status}
          </span>
          <span className="conversation-summary-from">From: {conversation.from}</span>
          <span className="conversation-summary-to">To: {conversation.to}</span>
        </div>
      </div>

      {conversation.desc && (
        <div className="conversation-summary-desc">
          <strong>Description:</strong> {conversation.desc}
        </div>
      )}

      {conversation.request.content && (
        <div className="conversation-summary-section">
          <strong>Request:</strong>
          <div className="conversation-summary-content">{conversation.request.content}</div>
          {conversation.request.references && Object.keys(conversation.request.references).length > 0 && (
            <ReferenceList
              sessionId={sessionId}
              references={conversation.request.references}
              onViewConversation={onViewDetail}
            />
          )}
        </div>
      )}

      {conversation.response.content && (
        <div className="conversation-summary-section">
          <strong>Response:</strong>
          <div className="conversation-summary-content">{conversation.response.content}</div>
          {conversation.response.references && Object.keys(conversation.response.references).length > 0 && (
            <ReferenceList
              sessionId={sessionId}
              references={conversation.response.references}
              onViewConversation={onViewDetail}
            />
          )}
        </div>
      )}

      {unansweredQuestion && (
        <div className="conversation-summary-section">
          <strong>Waiting Question:</strong>
          <div className="conversation-summary-content">{unansweredQuestion.question.content}</div>
        </div>
      )}

      {showAnswerBox && unansweredQuestion && (
        <div className="conversation-summary-answer-box">
          <form onSubmit={handleAnswer}>
            <textarea
              ref={answerInputRef}
              value={answerContent}
              onChange={(e) => setAnswerContent(e.target.value)}
              onFocus={() => { isEditingRef.current = true }}
              onBlur={() => { setTimeout(() => { isEditingRef.current = false }, 500) }}
              placeholder="输入回答..."
              className="conversation-summary-answer-input"
              rows={3}
              disabled={answering}
            />
            <div className="conversation-summary-answer-actions">
              <InfoReferenceSelector
                sessionId={sessionId}
                selectedReferences={answerReferences}
                onReferencesChange={setAnswerReferences}
              />
              <button
                type="submit"
                disabled={answering || !answerContent.trim()}
                className="conversation-summary-answer-button"
              >
                {answering ? '提交中...' : '提交回答'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default ConversationSummary

