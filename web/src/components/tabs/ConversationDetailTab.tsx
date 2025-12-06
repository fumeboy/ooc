import { useState, useEffect } from 'react'
import { conversationApi } from '../../api/client'
import type { Conversation } from '../../types/api'
import ReferenceList from '../ReferenceList'

interface ConversationDetailTabProps {
  sessionId: string
  conversationId: string
  onClose: () => void
}

export default function ConversationDetailTab({ sessionId, conversationId, onClose }: ConversationDetailTabProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadConversation = async () => {
      setLoading(true)
      try {
        const conv = await conversationApi.get(sessionId, conversationId)
        setConversation(conv)
      } catch (error) {
        console.error('Failed to fetch conversation:', error)
      } finally {
        setLoading(false)
      }
    }

    loadConversation()
  }, [sessionId, conversationId])

  if (loading) {
    return <div className="tab-loading">加载中...</div>
  }

  if (!conversation) {
    return <div className="tab-empty">Conversation 不存在</div>
  }

  return (
    <div className="conversation-detail-tab">
      <div className="conversation-detail-header">
        <button onClick={onClose} className="conversation-detail-close">×</button>
        <h3 className="conversation-detail-title">Conversation: {conversation.id}</h3>
      </div>
      <div className="conversation-detail-content">
        {conversation.title && (
          <div className="conversation-detail-section">
            <strong>Title:</strong>
            <div>{conversation.title}</div>
          </div>
        )}
        {conversation.desc && (
          <div className="conversation-detail-section">
            <strong>Description:</strong>
            <div>{conversation.desc}</div>
          </div>
        )}
        <div className="conversation-detail-section">
          <strong>From:</strong>
          <div>{conversation.from}</div>
        </div>
        <div className="conversation-detail-section">
          <strong>To:</strong>
          <div>{conversation.to}</div>
        </div>
        <div className="conversation-detail-section">
          <strong>Status:</strong>
          <div className={`conversation-detail-status status-${conversation.status}`}>
            {conversation.status}
          </div>
        </div>
        {conversation.request.content && (
          <div className="conversation-detail-section">
            <strong>Request:</strong>
            <div className="conversation-detail-text">{conversation.request.content}</div>
            {conversation.request.references && Object.keys(conversation.request.references).length > 0 && (
              <div className="conversation-detail-references">
                <strong>引用:</strong>
                <ReferenceList 
                  sessionId={sessionId} 
                  references={conversation.request.references}
                  onViewConversation={(convId) => {
                    // 在详情页面中，可以打开新的详情页面（如果需要的话）
                    // 这里暂时不处理，因为已经在详情页面了
                  }}
                />
              </div>
            )}
          </div>
        )}
        {conversation.response.content && (
          <div className="conversation-detail-section">
            <strong>Response:</strong>
            <div className="conversation-detail-text">{conversation.response.content}</div>
            {conversation.response.references && Object.keys(conversation.response.references).length > 0 && (
              <div className="conversation-detail-references">
                <strong>引用:</strong>
                <ReferenceList 
                  sessionId={sessionId} 
                  references={conversation.response.references}
                  onViewConversation={(convId) => {
                    // 在详情页面中，可以打开新的详情页面（如果需要的话）
                    // 这里暂时不处理，因为已经在详情页面了
                  }}
                />
              </div>
            )}
          </div>
        )}
        {conversation.questions.length > 0 && (
          <div className="conversation-detail-section">
            <strong>Questions:</strong>
            {conversation.questions.map((q) => (
              <div key={q.id} className="conversation-detail-question">
                <div className="conversation-detail-question-header">
                  <span>Q{q.id}:</span>
                  <div>{q.question.content}</div>
                </div>
                {q.answer.content && (
                  <div className="conversation-detail-question-answer">
                    <span>A:</span>
                    <div>{q.answer.content}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {conversation.actions.length > 0 && (
          <div className="conversation-detail-section">
            <strong>Actions:</strong>
            {conversation.actions.map((action, idx) => (
              <div key={idx} className="conversation-detail-action">
                <div className="conversation-detail-action-type">Type: {action.typ}</div>
                {action.typ === 'talk' && action.conversation_id && (
                  <div className="conversation-detail-action-info">
                    Conversation ID: {action.conversation_id}
                  </div>
                )}
                {action.typ === 'act' && (
                  <>
                    <div className="conversation-detail-action-info">
                      Object: {action.object}
                    </div>
                    <div className="conversation-detail-action-info">
                      Method: {action.method}
                    </div>
                    {action.response.content && (
                      <div className="conversation-detail-action-response">
                        Response: {action.response.content}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

