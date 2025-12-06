import { useState, useEffect } from 'react'
import { conversationApi } from '../../api/client'
import type { Conversation } from '../../types/api'
import InfoReferenceSelector from '../InfoReferenceSelector'
import ReferenceList from '../ReferenceList'

interface ConversationTreeNodeProps {
  sessionId: string
  conversation: Conversation
  expanded: boolean
  onToggle: (id: string) => void
  onAnswerQuestion: (conversationId: string, questionId: number, answer: string, references?: Record<string, string>) => void
  onViewDetail?: () => void
  level: number
  expandedNodes?: Set<string>
}

export default function ConversationTreeNode({
  sessionId,
  conversation,
  expanded,
  onToggle,
  onAnswerQuestion,
  onViewDetail,
  level,
  expandedNodes = new Set(),
}: ConversationTreeNodeProps) {
  const [children, setChildren] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (expanded && conversation.actions.length > 0) {
      loadChildren()
    } else {
      // 如果节点收起，清空子节点数据
      setChildren([])
    }
  }, [expanded, conversation.id, conversation.actions.length])

  const loadChildren = async () => {
    const talkActions = conversation.actions.filter((a) => a.typ === 'talk')
    if (talkActions.length === 0) return

    setLoading(true)
    try {
      const childConvs = await Promise.all(
        talkActions
          .map((a) => a.conversation_id)
          .filter((id): id is string => !!id)
          .map((id) => conversationApi.get(sessionId, id))
      )
      setChildren(childConvs)
    } catch (error) {
      console.error('Failed to load children:', error)
    } finally {
      setLoading(false)
    }
  }

  const hasChildren = conversation.actions.some((a) => a.typ === 'talk')
  const unansweredQuestions = conversation.questions.filter((q) => !q.answer.content)

  return (
    <div className="conversation-tree-node" style={{ marginLeft: `${level * 20}px` }}>
      <div className="conversation-tree-node-header">
        <button
          className="conversation-tree-node-toggle"
          onClick={() => onToggle(conversation.id)}
          disabled={!hasChildren}
        >
          {hasChildren ? (expanded ? '▼' : '▶') : '•'}
        </button>
        <span className="conversation-tree-node-id">{conversation.id}</span>
        {conversation.title && (
          <span className="conversation-tree-node-title">{conversation.title}</span>
        )}
        {!conversation.title && conversation.request.content && (
          <span className="conversation-tree-node-title">
            {conversation.request.content.substring(0, 50)}
            {conversation.request.content.length > 50 ? '...' : ''}
          </span>
        )}
        {conversation.status && (
          <span className={`conversation-tree-node-status status-${conversation.status}`}>
            {conversation.status}
          </span>
        )}
        {onViewDetail && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onViewDetail()
            }}
            className="conversation-tree-node-view-detail"
            title="查看详情"
          >
            🔗
          </button>
        )}
      </div>

      {expanded && (
        <div className="conversation-tree-node-content">
          {conversation.desc && (
            <div className="conversation-tree-node-desc">{conversation.desc}</div>
          )}

          {conversation.request.content && (
            <div className="conversation-tree-node-section">
              <strong>Request:</strong>
              <div className="conversation-tree-node-text">{conversation.request.content}</div>
              {conversation.request.references && Object.keys(conversation.request.references).length > 0 && (
                <div className="conversation-tree-node-references">
                  <strong>引用:</strong>
                  <ReferenceList 
                    sessionId={sessionId} 
                    references={conversation.request.references}
                    onViewConversation={onViewDetail}
                  />
                </div>
              )}
            </div>
          )}

          {conversation.response.content && (
            <div className="conversation-tree-node-section">
              <strong>Response:</strong>
              <div className="conversation-tree-node-text">{conversation.response.content}</div>
              {conversation.response.references && Object.keys(conversation.response.references).length > 0 && (
                <div className="conversation-tree-node-references">
                  <strong>引用:</strong>
                  <ReferenceList 
                    sessionId={sessionId} 
                    references={conversation.response.references}
                    onViewConversation={onViewDetail}
                  />
                </div>
              )}
            </div>
          )}

          {unansweredQuestions.length > 0 && (
            <div className="conversation-tree-node-questions">
              <strong>待回答问题:</strong>
              {unansweredQuestions.map((q) => (
                <QuestionAnswerForm
                  key={q.id}
                  sessionId={sessionId}
                  conversationId={conversation.id}
                  question={q}
                  onAnswer={(answer, references) => onAnswerQuestion(conversation.id, q.id, answer, references)}
                />
              ))}
            </div>
          )}

          {loading && <div className="conversation-tree-node-loading">加载子节点...</div>}

          {!loading && children.length > 0 && (
            <div className="conversation-tree-node-children">
          {children.map((child) => (
            <ConversationTreeNode
              key={child.id}
              sessionId={sessionId}
              conversation={child}
                  expanded={expandedNodes.has(child.id)}
              onToggle={onToggle}
              onAnswerQuestion={onAnswerQuestion}
              onViewDetail={onViewDetail}
              level={level + 1}
                  expandedNodes={expandedNodes}
            />
          ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface QuestionAnswerFormProps {
  sessionId: string
  conversationId: string
  question: { id: number; question: { content: string } }
  onAnswer: (answer: string, references?: Record<string, string>) => void
}

function QuestionAnswerForm({ sessionId, conversationId, question, onAnswer }: QuestionAnswerFormProps) {
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [references, setReferences] = useState<Record<string, string>>({})

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!answer.trim()) return

    setSubmitting(true)
    try {
      await onAnswer(answer, Object.keys(references).length > 0 ? references : undefined)
      setAnswer('')
      setReferences({})
    } catch (error) {
      console.error('Failed to submit answer:', error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="question-answer-form">
      <div className="question-answer-question">
        <strong>Q:</strong> {question.question.content}
      </div>
      <form onSubmit={handleSubmit} className="question-answer-form-input">
        <input
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="输入回答..."
          disabled={submitting}
        />
        <InfoReferenceSelector
          sessionId={sessionId}
          selectedReferences={references}
          onReferencesChange={setReferences}
        />
        <button type="submit" disabled={submitting || !answer.trim()}>
          {submitting ? '提交中...' : '回答'}
        </button>
      </form>
    </div>
  )
}

