import { useState, useEffect } from 'react'
import { sessionApi, conversationApi, continueApi } from '../../api/client'
import type { Session, Conversation } from '../../types/api'
import ConversationTreeNode from './ConversationTreeNode'
import ConversationDetailTab from './ConversationDetailTab'
import InfoReferenceSelector from '../InfoReferenceSelector'

interface ConversationTreeTabProps {
  sessionId: string
  viewingConversationId?: string | null
  onViewConversation?: (conversationId: string) => void
  onCloseConversation?: () => void
}

export default function ConversationTreeTab({ 
  sessionId, 
  viewingConversationId: externalViewingConversationId,
  onViewConversation,
  onCloseConversation 
}: ConversationTreeTabProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [continueContent, setContinueContent] = useState('')
  const [continueReferences, setContinueReferences] = useState<Record<string, string>>({})
  const [continuing, setContinuing] = useState(false)
  const [internalViewingConversationId, setInternalViewingConversationId] = useState<string | null>(null)

  // 使用外部传入的 viewingConversationId，如果没有则使用内部状态
  const viewingConversationId = externalViewingConversationId ?? internalViewingConversationId

  const handleViewConversation = (conversationId: string) => {
    // 如果 conversationId 是 InfoID 格式（conversation::xxx），提取出实际的 ID
    let actualConvId = conversationId
    if (conversationId.startsWith('conversation::')) {
      actualConvId = conversationId.substring('conversation::'.length)
    }

    if (onViewConversation) {
      onViewConversation(actualConvId)
    } else {
      setInternalViewingConversationId(actualConvId)
    }
  }

  const handleCloseConversation = () => {
    if (onCloseConversation) {
      onCloseConversation()
    } else {
      setInternalViewingConversationId(null)
    }
  }

  const refresh = async () => {
    setLoading(true)
    try {
      const sess = await sessionApi.get(sessionId)
      setSession(sess)

      // 获取所有 conversation 列表
      const convsResponse = await conversationApi.list(sessionId)
      setConversations(convsResponse.conversations)
      
      // 默认展开所有 conversation
      if (convsResponse.conversations.length > 0) {
        setExpandedNodes(new Set(convsResponse.conversations.map(c => c.id)))
      }
    } catch (error) {
      console.error('Failed to fetch session/conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [sessionId])

  const toggleNode = (id: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedNodes(newExpanded)
  }

  const handleAnswerQuestion = async (conversationId: string, questionId: number, answer: string, references?: Record<string, string>) => {
    try {
      await conversationApi.answerAsk(sessionId, {
        conversation_id: conversationId,
        question_id: questionId,
        answer,
        references,
      })
      await refresh()
    } catch (error) {
      console.error('Failed to answer question:', error)
      alert('回答失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!continueContent.trim()) return
    
    // 如果 session 是 pending，不允许发起 continue
    if (session?.status === 'pending') {
      alert('系统正在处理中，请稍候...')
      return
    }

    setContinuing(true)
    try {
      await continueApi.continue(sessionId, {
        content: continueContent,
        references: Object.keys(continueReferences).length > 0 ? continueReferences : undefined,
      })
      setContinueContent('')
      setContinueReferences({})
      await refresh()
    } catch (error) {
      console.error('Failed to continue conversation:', error)
      alert('继续对话失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setContinuing(false)
    }
  }

  if (loading && conversations.length === 0) {
    return <div className="tab-loading">加载中...</div>
  }

  // 如果正在查看 conversation 详情，显示详情 tab
  if (viewingConversationId) {
    return (
      <ConversationDetailTab
        sessionId={sessionId}
        conversationId={viewingConversationId}
        onClose={handleCloseConversation}
      />
    )
  }

  if (conversations.length === 0) {
    return <div className="tab-empty">暂无 Conversation</div>
  }

  return (
    <div className="conversation-tree-tab">
      <div className="tab-header">
        <button onClick={refresh} disabled={loading} className="refresh-button">
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="conversation-tree-content">
        {conversations.map((conv) => (
          <ConversationTreeNode
            key={conv.id}
            sessionId={sessionId}
            conversation={conv}
            expanded={expandedNodes.has(conv.id)}
            onToggle={toggleNode}
            onAnswerQuestion={handleAnswerQuestion}
            onViewDetail={() => handleViewConversation(conv.id)}
            level={0}
            expandedNodes={expandedNodes}
          />
        ))}
      </div>
      <div className="conversation-continue">
        {session?.status === 'pending' && (
          <div className="conversation-continue-notice">
            <span className="conversation-continue-notice-icon">⏳</span>
            <span className="conversation-continue-notice-text">系统正在处理中，请稍候...</span>
          </div>
        )}
        <form onSubmit={handleContinue} className="conversation-continue-form">
          <div className="conversation-continue-input-wrapper">
            <textarea
              value={continueContent}
              onChange={(e) => setContinueContent(e.target.value)}
              placeholder={session?.status === 'pending' ? '系统正在处理中，无法继续对话...' : '继续对话...'}
              className="conversation-continue-input"
              rows={3}
              disabled={continuing || session?.status === 'pending'}
            />
            <div className="conversation-continue-actions">
              <InfoReferenceSelector
                sessionId={sessionId}
                selectedReferences={continueReferences}
                onReferencesChange={setContinueReferences}
              />
              <button
                type="submit"
                disabled={continuing || !continueContent.trim() || session?.status === 'pending'}
                className="conversation-continue-button"
              >
                {continuing ? '发送中...' : '发送'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

