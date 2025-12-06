import { infoApi } from '../api/client'
import type { InfoListItem } from '../types/api'
import { useState, useEffect } from 'react'

interface ReferenceListProps {
  sessionId: string
  references?: Record<string, string> // key = info id, value = reason
  onViewConversation?: (conversationId: string) => void // 点击 conversation 引用时的回调
}

export default function ReferenceList({ sessionId, references, onViewConversation }: ReferenceListProps) {
  // 从 InfoID 中提取 ConversationID（如果是 conversation::xxx 格式）
  const extractConversationId = (infoId: string): string | null => {
    if (infoId.startsWith('conversation::')) {
      return infoId.substring('conversation::'.length)
    }
    return null
  }

  const handleClick = (infoId: string) => {
    const convId = extractConversationId(infoId)
    if (convId && onViewConversation) {
      onViewConversation(convId)
    }
  }
  const [infos, setInfos] = useState<Map<string, InfoListItem>>(new Map())
  const [loading, setLoading] = useState(false)

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
  }, [sessionId, references])

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

