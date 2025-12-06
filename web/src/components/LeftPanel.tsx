import { useState, useEffect } from 'react'
import ConversationTreeTab from './tabs/ConversationTreeTab'
import InfoListTab from './tabs/InfoListTab'
import LLMRequestsTab from './tabs/LLMRequestsTab'
import { sessionApi, possessApi } from '../api/client'

interface LeftPanelProps {
  sessionId: string | null
}

type TabType = 'conversation' | 'info' | 'llm'

export default function LeftPanel({ sessionId }: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  const [hasPossessRequest, setHasPossessRequest] = useState(false)
  const [viewingConversationId, setViewingConversationId] = useState<string | null>(null)

  // 检查是否有待处理的附身请求
  useEffect(() => {
    if (!sessionId) {
      setHasPossessRequest(false)
      return
    }

    const checkPossessRequest = async () => {
      try {
        const session = await sessionApi.get(sessionId)
        if (session.possessed) {
          const request = await possessApi.getRequest(sessionId)
          setHasPossessRequest(request.has_request)
        } else {
          setHasPossessRequest(false)
        }
      } catch (error) {
        console.error('Failed to check possess request:', error)
        setHasPossessRequest(false)
      }
    }

    checkPossessRequest()
    // 每2秒检查一次
    const interval = setInterval(checkPossessRequest, 2000)
    return () => clearInterval(interval)
  }, [sessionId])

  if (!sessionId) {
    return (
      <div className="left-panel">
        <div className="left-panel-empty">
          <p>请从右侧选择一个 Session</p>
        </div>
      </div>
    )
  }

  return (
    <div className="left-panel">
      <div className="left-panel-tabs">
        <button
          className={`tab-button ${activeTab === 'conversation' ? 'active' : ''}`}
          onClick={() => setActiveTab('conversation')}
        >
          Conversation Tree
        </button>
        <button
          className={`tab-button ${activeTab === 'info' ? 'active' : ''}`}
          onClick={() => setActiveTab('info')}
        >
          Info List
        </button>
        <button
          className={`tab-button ${activeTab === 'llm' ? 'active' : ''}`}
          onClick={() => setActiveTab('llm')}
        >
          LLM Requests
          {hasPossessRequest && <span className="tab-button-badge"></span>}
        </button>
      </div>
      <div className="left-panel-content">
        {activeTab === 'conversation' && (
          <ConversationTreeTab 
            sessionId={sessionId} 
            viewingConversationId={viewingConversationId}
            onViewConversation={(conversationId) => {
              setViewingConversationId(conversationId)
            }}
            onCloseConversation={() => {
              setViewingConversationId(null)
            }}
          />
        )}
        {activeTab === 'info' && (
          <InfoListTab 
            sessionId={sessionId} 
            onViewConversation={(conversationId) => {
              setViewingConversationId(conversationId)
              setActiveTab('conversation')
            }}
          />
        )}
        {activeTab === 'llm' && <LLMRequestsTab sessionId={sessionId} />}
      </div>
    </div>
  )
}

