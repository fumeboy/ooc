import { useState, useEffect, useCallback } from 'react'
import { manualThinkApi, possessApi, sessionApi } from '../../api/client'
import type { Conversation } from '../../types/api'
import ConversationSummary from '../ConversationSummary'

interface WaitingManualConversationsProps {
  sessionId: string
  onViewConversation: (conversationId: string) => void
}

export default function WaitingManualConversations({
  sessionId,
  onViewConversation,
}: WaitingManualConversationsProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [possessed, setPossessed] = useState(false)
  const [settingPossess, setSettingPossess] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const response = await manualThinkApi.getWaitingManualConversations(sessionId)
      
      // 只在 conversations 列表真正变化时才更新，保持未变化的 conversation 对象引用
      setConversations(prev => {
        if (prev.length !== response.conversations.length) {
          return response.conversations
        }
        
        // 构建新数组，但保持未变化的 conversation 对象引用
        let hasChanges = false
        const newConversations = response.conversations.map((newConv) => {
          // 查找 prev 中相同 id 的 conversation
          const prevConv = prev.find(p => p.id === newConv.id)
          
          // 如果找不到，说明是新 conversation
          if (!prevConv) {
            hasChanges = true
            return newConv
          }
          
          // 比较 id 和 updated_at，如果都相同则不需要更新
          if (prevConv.id === newConv.id && prevConv.updated_at === newConv.updated_at) {
            // 没有变化，保持原对象引用
            return prevConv
          }
          
          // updated_at 有变化，需要更新
          hasChanges = true
          return newConv
        })
        
        if (hasChanges) {
          return newConversations
        }
        
        // 完全没有变化，返回原数组引用
        return prev
      })
    } catch (error) {
      console.error('Failed to fetch waiting manual conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  // 使用 useCallback 缓存回调函数，避免每次渲染都创建新函数
  const handleViewConversation = useCallback((conversationId: string) => {
    onViewConversation(conversationId)
  }, [onViewConversation])

  // 加载 session 的 possess 状态
  const loadPossessStatus = async () => {
    try {
      const session = await sessionApi.get(sessionId)
      setPossessed(session.possessed)
    } catch (error) {
      console.error('Failed to load possess status:', error)
    }
  }

  // 切换 possess 状态
  const handleTogglePossess = async () => {
    setSettingPossess(true)
    try {
      const response = await possessApi.setPossess(sessionId, {
        possess: !possessed,
      })
      setPossessed(response.possessed)
    } catch (error) {
      console.error('Failed to set possess:', error)
      alert('设置失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSettingPossess(false)
    }
  }

  useEffect(() => {
    refresh()
    loadPossessStatus()
    const interval = setInterval(refresh, 2000) // 每2秒刷新一次
    return () => clearInterval(interval)
  }, [sessionId])

  if (loading && conversations.length === 0) {
    return <div className="tab-loading">加载中...</div>
  }

  if (conversations.length === 0) {
    return (
      <div className="waiting-manual-conversations">
        <div className="tab-header">
          <div className="tab-header-left">
            <button onClick={refresh} disabled={loading} className="refresh-button">
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
          <div className="tab-header-right">
            <label className="possess-toggle">
              <span className="possess-toggle-label">附身模式:</span>
              <input
                type="checkbox"
                checked={possessed}
                onChange={handleTogglePossess}
                disabled={settingPossess}
                className="possess-toggle-input"
              />
              <span className="possess-toggle-slider"></span>
            </label>
          </div>
        </div>
        <div className="tab-empty">暂无等待手动思考的 Conversation</div>
      </div>
    )
  }

  return (
    <div className="waiting-manual-conversations">
      <div className="tab-header">
        <div className="tab-header-left">
          <button onClick={refresh} disabled={loading} className="refresh-button">
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
        <div className="tab-header-right">
          <label className="possess-toggle">
            <span className="possess-toggle-label">附身模式:</span>
            <input
              type="checkbox"
              checked={possessed}
              onChange={handleTogglePossess}
              disabled={settingPossess}
              className="possess-toggle-input"
            />
            <span className="possess-toggle-slider"></span>
          </label>
        </div>
      </div>
      <div className="waiting-manual-conversations-content">
        {conversations.map((conv) => (
          <ConversationSummary
            key={conv.id}
            sessionId={sessionId}
            conversation={conv}
            onViewDetail={handleViewConversation}
            onRefresh={refresh}
          />
        ))}
      </div>
    </div>
  )
}

