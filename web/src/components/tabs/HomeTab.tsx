import { useState, useEffect, useRef, useCallback } from 'react'
import { conversationApi, talkApi } from '../../api/client'
import type { Conversation } from '../../types/api'
import ConversationSummary from '../ConversationSummary'
import InfoReferenceSelector from '../InfoReferenceSelector'

interface HomeTabProps {
  sessionId: string
  onViewConversation: (conversationId: string) => void
}

export default function HomeTab({ sessionId, onViewConversation }: HomeTabProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(false)
  const [talkContent, setTalkContent] = useState('')
  const [talkTitle, setTalkTitle] = useState('')
  const [talkWith, setTalkWith] = useState('system::system')
  const [talkReferences, setTalkReferences] = useState<Record<string, string>>({})
  const [talking, setTalking] = useState(false)

  // 使用 ref 来跟踪用户是否正在编辑，避免刷新时失去焦点
  const isEditingRef = useRef(false)
  const inputRefs = useRef<{ talkWith?: HTMLInputElement; talkTitle?: HTMLInputElement; talkContent?: HTMLTextAreaElement }>({})

  const refresh = async () => {
    // 如果用户正在编辑，跳过刷新
    if (isEditingRef.current) {
      return
    }
    
    setLoading(true)
    try {
      const response = await conversationApi.list(sessionId)
      
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
      console.error('Failed to fetch conversations:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 2000) // 每2秒刷新一次
    return () => clearInterval(interval)
  }, [sessionId])
  
  // 监听用户输入，标记为正在编辑
  useEffect(() => {
    if (talkContent || talkTitle || talkWith) {
      isEditingRef.current = true
      const timer = setTimeout(() => {
        isEditingRef.current = false
      }, 1000) // 用户停止输入1秒后，允许刷新
      return () => clearTimeout(timer)
    } else {
      isEditingRef.current = false
    }
  }, [talkContent, talkTitle, talkWith])

  // 使用 useCallback 缓存回调函数，避免每次渲染都创建新函数
  const handleViewConversation = useCallback((conversationId: string) => {
    onViewConversation(conversationId)
  }, [onViewConversation])

  const handleTalk = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!talkContent.trim()) return

    setTalking(true)
    try {
      await talkApi.talk(sessionId, {
        talk_with: talkWith,
        title: talkTitle || undefined,
        content: talkContent,
        references: Object.keys(talkReferences).length > 0 ? talkReferences : undefined,
      })
      setTalkContent('')
      setTalkTitle('')
      setTalkReferences({})
      await refresh()
    } catch (error) {
      console.error('Failed to talk:', error)
      alert('发送失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setTalking(false)
    }
  }

  if (loading && conversations.length === 0) {
    return <div className="tab-loading">加载中...</div>
  }

  return (
    <div className="home-tab">
      <div className="home-tab-header">
        <button onClick={refresh} disabled={loading} className="refresh-button">
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="home-tab-content">
        {conversations.length === 0 ? (
          <div className="tab-empty">暂无 Conversation</div>
        ) : (
          conversations.map((conv) => (
            <ConversationSummary
              key={conv.id}
              sessionId={sessionId}
              conversation={conv}
              onViewDetail={handleViewConversation}
              onRefresh={refresh}
            />
          ))
        )}
      </div>
      <div className="home-tab-footer">
        <form onSubmit={handleTalk} className="home-tab-talk-form">
          <div className="home-tab-talk-inputs">
            <input
              ref={(el) => { if (el) inputRefs.current.talkWith = el }}
              type="text"
              value={talkWith}
              onChange={(e) => setTalkWith(e.target.value)}
              onFocus={() => { isEditingRef.current = true }}
              onBlur={() => { setTimeout(() => { isEditingRef.current = false }, 500) }}
              placeholder="Talk With (e.g., system::system)"
              className="home-tab-talk-with"
              disabled={talking}
            />
            <input
              ref={(el) => { if (el) inputRefs.current.talkTitle = el }}
              type="text"
              value={talkTitle}
              onChange={(e) => setTalkTitle(e.target.value)}
              onFocus={() => { isEditingRef.current = true }}
              onBlur={() => { setTimeout(() => { isEditingRef.current = false }, 500) }}
              placeholder="Title (optional)"
              className="home-tab-talk-title"
              disabled={talking}
            />
          </div>
          <textarea
            ref={(el) => { if (el) inputRefs.current.talkContent = el }}
            value={talkContent}
            onChange={(e) => setTalkContent(e.target.value)}
            onFocus={() => { isEditingRef.current = true }}
            onBlur={() => { setTimeout(() => { isEditingRef.current = false }, 500) }}
            placeholder="输入内容..."
            className="home-tab-talk-content"
            rows={3}
            disabled={talking}
          />
          <div className="home-tab-talk-actions">
            <InfoReferenceSelector
              sessionId={sessionId}
              selectedReferences={talkReferences}
              onReferencesChange={setTalkReferences}
            />
            <button
              type="submit"
              disabled={talking || !talkContent.trim()}
              className="home-tab-talk-button"
            >
              {talking ? '发送中...' : '发送'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

