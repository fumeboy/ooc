import { useState, useEffect } from 'react'
import { infoApi } from '../api/client'
import type { InfoListItem } from '../types/api'

interface InfoReferenceSelectorProps {
  sessionId: string
  selectedReferences: Record<string, string>
  onReferencesChange: (references: Record<string, string>) => void
}

export default function InfoReferenceSelector({
  sessionId,
  selectedReferences,
  onReferencesChange,
}: InfoReferenceSelectorProps) {
  const [infos, setInfos] = useState<InfoListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (expanded && infos.length === 0) {
      loadInfos()
    }
  }, [expanded])

  const loadInfos = async () => {
    setLoading(true)
    try {
      const response = await infoApi.list(sessionId)
      setInfos(response.infos)
    } catch (error) {
      console.error('Failed to load infos:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleReference = (infoId: string) => {
    const newRefs = { ...selectedReferences }
    if (newRefs[infoId] !== undefined) {
      // 如果已选中，删除引用
      delete newRefs[infoId]
    } else {
      // 如果未选中，添加引用（初始值为空字符串）
      newRefs[infoId] = ''
    }
    onReferencesChange(newRefs)
  }

  const updateReason = (infoId: string, reason: string) => {
    const newRefs = { ...selectedReferences }
    // 只有当引用已存在时才更新 reason，不删除引用（即使 reason 为空字符串）
    if (newRefs[infoId] !== undefined) {
      newRefs[infoId] = reason
    }
    onReferencesChange(newRefs)
  }

  return (
    <div className="info-reference-selector">
      <button
        type="button"
        onClick={() => {
          setExpanded(!expanded)
          if (!expanded) {
            loadInfos()
          }
        }}
        className="info-reference-toggle"
      >
        {expanded ? '▼' : '▶'} 引用 Info ({Object.keys(selectedReferences).length})
      </button>
      {expanded && (
        <div className="info-reference-list">
          {loading ? (
            <div className="info-reference-loading">加载中...</div>
          ) : infos.length === 0 ? (
            <div className="info-reference-empty">暂无 Info</div>
          ) : (
            infos.map((info) => {
              // 使用 !== undefined 检查，因为值可能是空字符串
              const isSelected = selectedReferences[info.id] !== undefined
              return (
                <div key={info.id} className="info-reference-item">
                  <label className="info-reference-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleReference(info.id)}
                    />
                    <span className="info-reference-name">{info.name}</span>
                    <span className="info-reference-class">({info.class})</span>
                  </label>
                  {isSelected && (
                    <input
                      type="text"
                      placeholder="引用原因（可选）"
                      value={selectedReferences[info.id] || ''}
                      onChange={(e) => updateReason(info.id, e.target.value)}
                      className="info-reference-reason"
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

