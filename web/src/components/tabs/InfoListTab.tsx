import { useState, useEffect } from 'react'
import { infoApi } from '../../api/client'
import type { InfoListItem, Info } from '../../types/api'

interface InfoListTabProps {
  sessionId: string
}

export default function InfoListTab({ sessionId, onViewConversation }: InfoListTabProps) {
  const [infos, setInfos] = useState<InfoListItem[]>([])
  const [selectedInfo, setSelectedInfo] = useState<Info | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const response = await infoApi.list(sessionId)
      setInfos(response.infos)
    } catch (error) {
      console.error('Failed to fetch infos:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [sessionId])

  const handleViewDetail = async (infoId: string, infoClass: string) => {
    // 如果是 conversation 类型，直接查看 conversation 详情
    if (infoClass === 'conversation' && onViewConversation) {
      // 从 InfoID 格式（conversation::xxx）中提取出实际的 ConversationID（xxx）
      let actualConvId = infoId
      if (infoId.startsWith('conversation::')) {
        actualConvId = infoId.substring('conversation::'.length)
      }
      onViewConversation(actualConvId)
      return
    }

    if (selectedInfo?.id === infoId) {
      setSelectedInfo(null)
      return
    }

    // 只有在展开时才从后端获取详细信息
    setDetailLoading(true)
    try {
      const info = await infoApi.get(sessionId, infoId, true) // 传入 true 获取详细信息
      setSelectedInfo(info)
    } catch (error) {
      console.error('Failed to fetch info detail:', error)
    } finally {
      setDetailLoading(false)
    }
  }

  if (loading && infos.length === 0) {
    return <div className="tab-loading">加载中...</div>
  }

  return (
    <div className="info-list-tab">
      <div className="tab-header">
        <button onClick={refresh} disabled={loading} className="refresh-button">
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="info-list-content">
        {infos.length === 0 ? (
          <div className="tab-empty">暂无 Info</div>
        ) : (
          <ul className="info-list-items">
            {infos.map((info) => (
              <li key={info.id} className="info-list-item">
                <div className="info-list-item-header">
                  <span className="info-list-item-id">{info.id}</span>
                  <span className="info-list-item-class">{info.class}</span>
                </div>
                <div className="info-list-item-content">
                  <div className="info-list-item-name">{info.name}</div>
                  <div className="info-list-item-description">{info.description}</div>
                  <button
                    onClick={() => handleViewDetail(info.id, info.class)}
                    className="info-list-item-detail-button"
                    title={info.class === 'conversation' ? '查看 Conversation 详情' : (selectedInfo?.id === info.id ? '隐藏详情' : '查看详情')}
                  >
                    {info.class === 'conversation' ? '🔗' : (selectedInfo?.id === info.id ? '▼' : '▶')}
                  </button>
                </div>
                {selectedInfo?.id === info.id && info.class !== 'conversation' && (
                  <div className="info-list-item-detail">
                    {detailLoading ? (
                      <div>加载中...</div>
                    ) : (
                      <>
                        {selectedInfo.prompt && (
                          <div className="info-list-item-detail-section">
                            <strong>Prompt:</strong>
                            <pre className="info-list-item-detail-prompt">{selectedInfo.prompt}</pre>
                          </div>
                        )}
                        {selectedInfo.methods && selectedInfo.methods.length > 0 && (
                          <div className="info-list-item-detail-section">
                            <strong>Methods:</strong>
                            <ul className="info-list-item-detail-methods">
                              {selectedInfo.methods.map((method, idx) => (
                                <li key={idx}>{method}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

