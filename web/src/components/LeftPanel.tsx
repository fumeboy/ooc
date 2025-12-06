import { useState, useEffect } from 'react'
import ConversationViewer from './tabs/ConversationViewer'
import InfoListTab from './tabs/InfoListTab'
import WaitingManualConversations from './tabs/WaitingManualConversations'
import { manualThinkApi } from '../api/client'

interface LeftPanelProps {
  sessionId: string | null
}

type TabType = 'conversation' | 'info' | 'llm'

export default function LeftPanel({ sessionId }: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('conversation')
  const [hasWaitingManualConversations, setHasWaitingManualConversations] = useState(false)

  // 检查是否有待处理的手动思考请求
  useEffect(() => {
    if (!sessionId) {
      setHasWaitingManualConversations(false)
      return
    }

    const checkWaitingManualConversations = async () => {
      try {
        const response = await manualThinkApi.getWaitingManualConversations(sessionId)
        setHasWaitingManualConversations(response.conversations.length > 0)
      } catch (error) {
        console.error('Failed to check waiting manual conversations:', error)
        setHasWaitingManualConversations(false)
      }
    }

    checkWaitingManualConversations()
    // 每2秒检查一次
    const interval = setInterval(checkWaitingManualConversations, 2000)
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
          Waiting Manual
          {hasWaitingManualConversations && <span className="tab-button-badge"></span>}
        </button>
      </div>
      <div className="left-panel-content">
        {activeTab === 'conversation' && (
          <ConversationViewer 
            sessionId={sessionId} 
          />
        )}
        {activeTab === 'info' && (
          <InfoListTab 
            sessionId={sessionId} 
          />
        )}
        {activeTab === 'llm' && (
          <WaitingManualConversations 
            sessionId={sessionId}
            onViewConversation={() => {
              setActiveTab('conversation')
            }}
          />
        )}
      </div>
    </div>
  )
}

