import { infoApi } from '../api/client'
import type { InfoListItem } from '../types/api'
import { useState, useEffect, memo, useCallback, useMemo } from 'react'

interface ReferenceListProps {
  sessionId: string
  references?: Record<string, string> // key = info id, value = reason
  onViewConversation?: (conversationId: string) => void // 点击 conversation 引用时的回调
}

function ReferenceList({ sessionId, references, onViewConversation }: ReferenceListProps) {
  // 从 InfoID 中提取 ConversationID（如果是 conversation::xxx 格式）
  const extractConversationId = (infoId: string): string | null => {
    if (infoId.startsWith('conversation::')) {
      return infoId.substring('conversation::'.length)
    }
    return null
  }

  const [infos, setInfos] = useState<Map<string, InfoListItem>>(new Map())
  const [loading, setLoading] = useState(false)

  // 使用 useMemo 缓存 references 的键，避免每次渲染都重新计算
  const referencesKeys = useMemo(() => {
    if (!references) return ''
    return Object.keys(references).sort().join(',')
  }, [references])

  useEffect(() => {
    if (!references || Object.keys(references).length === 0) {
      return
    }

    const loadInfos = async () => {
      setLoading(true)
      try {
        const response = await infoApi.list(sessionId)
        const infoMap = new Map<string, InfoListItem>()
        response.infos.forEach((info) => {
          infoMap.set(info.id, info)
        })
        setInfos(infoMap)
      } catch (error) {
        console.error('Failed to load infos:', error)
      } finally {
        setLoading(false)
      }
    }

    loadInfos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, referencesKeys])

  // 使用 useCallback 缓存 handleClick，避免每次渲染都创建新函数
  const handleClick = useCallback((infoId: string) => {
    const convId = extractConversationId(infoId)
    if (convId && onViewConversation) {
      onViewConversation(convId)
    }
  }, [onViewConversation])

  if (!references || Object.keys(references).length === 0) {
    return null
  }

  if (loading) {
    return <div className="reference-list-loading">加载引用中...</div>
  }

  return (
    <div className="reference-list">
      {Object.entries(references).map(([infoId, reason]) => {
        const info = infos.get(infoId)
        const convId = extractConversationId(infoId)
        const isConversation = convId !== null
        const isClickable = isConversation && onViewConversation !== undefined

        return (
          <div 
            key={infoId} 
            className={`reference-list-item ${isClickable ? 'reference-list-item-clickable' : ''}`}
            onClick={isClickable ? () => handleClick(infoId) : undefined}
            title={isClickable ? '点击查看 Conversation 详情' : undefined}
          >
            <span className="reference-list-item-id">{infoId}</span>
            {info && (
              <>
                <span className="reference-list-item-name">{info.name}</span>
                <span className="reference-list-item-class">({info.class})</span>
              </>
            )}
            {reason && (
              <span className="reference-list-item-reason">: {reason}</span>
            )}
            {isClickable && (
              <span className="reference-list-item-link">🔗</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// 使用 React.memo 优化组件，只在 props 真正变化时才重新渲染
export default memo(ReferenceList, (prevProps, nextProps) => {
  // 比较 sessionId
  if (prevProps.sessionId !== nextProps.sessionId) {
    return false
  }
  
  // 比较 onViewConversation 引用
  if (prevProps.onViewConversation !== nextProps.onViewConversation) {
    return false
  }
  
  // 深度比较 references
  const prevRefs = prevProps.references || {}
  const nextRefs = nextProps.references || {}
  
  const prevKeys = Object.keys(prevRefs).sort()
  const nextKeys = Object.keys(nextRefs).sort()
  
  if (prevKeys.length !== nextKeys.length) {
    return false
  }
  
  for (let i = 0; i < prevKeys.length; i++) {
    if (prevKeys[i] !== nextKeys[i]) {
      return false
    }
    if (prevRefs[prevKeys[i]] !== nextRefs[nextKeys[i]]) {
      return false
    }
  }
  
  return true // props 相同，不需要重新渲染
})

