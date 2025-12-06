import { useState } from 'react'
import HomeTab from './HomeTab'
import ConversationDetailTab from './ConversationDetailTab'
import type { Conversation } from '../../types/api'

interface Tab {
  id: string
  type: 'home' | 'detail'
  title: string
  conversationId?: string
}

interface ConversationViewerProps {
  sessionId: string
}

export default function ConversationViewer({ sessionId }: ConversationViewerProps) {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'home', type: 'home', title: 'Home' }])
  const [activeTabId, setActiveTabId] = useState<string>('home')

  const handleViewConversation = (conversationId: string) => {
    // 检查是否已经存在该 conversation 的 tab
    const existingTab = tabs.find((t) => t.type === 'detail' && t.conversationId === conversationId)
    if (existingTab) {
      setActiveTabId(existingTab.id)
      return
    }

    // 创建新的 detail tab
    const newTab: Tab = {
      id: `detail-${conversationId}`,
      type: 'detail',
      title: `Conversation: ${conversationId.substring(0, 8)}...`,
      conversationId,
    }
    setTabs([...tabs, newTab])
    setActiveTabId(newTab.id)
  }

  const handleCloseTab = (tabId: string) => {
    if (tabId === 'home') return // 不能关闭 home tab

    const newTabs = tabs.filter((t) => t.id !== tabId)
    setTabs(newTabs)

    // 如果关闭的是当前 tab，切换到最后一个 tab
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[newTabs.length - 1].id)
    }
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]

  return (
    <div className="conversation-viewer">
      <div className="conversation-viewer-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`conversation-viewer-tab ${activeTabId === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span>{tab.title}</span>
            {tab.id !== 'home' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleCloseTab(tab.id)
                }}
                className="conversation-viewer-tab-close"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="conversation-viewer-content">
        {activeTab.type === 'home' && (
          <HomeTab sessionId={sessionId} onViewConversation={handleViewConversation} />
        )}
        {activeTab.type === 'detail' && activeTab.conversationId && (
          <ConversationDetailTab
            sessionId={sessionId}
            conversationId={activeTab.conversationId}
            onClose={() => handleCloseTab(activeTab.id)}
          />
        )}
      </div>
    </div>
  )
}

