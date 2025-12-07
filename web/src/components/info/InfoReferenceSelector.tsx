// Info 引用选择器：从后端拉取 Info 列表，允许多选并填充引用理由。
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { infosBySessionAtom } from '../../atoms'
import { listInfos } from '../../api/client'
import type { InfoListItem } from '../../types/api'

interface Props {
  sessionId: string
  selectedReferences: Record<string, string>
  onReferencesChange: (refs: Record<string, string>) => void
}

export default function InfoReferenceSelector({ sessionId, selectedReferences, onReferencesChange }: Props) {
  const [infosMap, setInfosMap] = useAtom(infosBySessionAtom)
  const [loading, setLoading] = useState(false)
  const infos: InfoListItem[] = infosMap[sessionId] || []

  useEffect(() => {
    let mounted = true
    if (!sessionId) return
    const fetchInfos = async () => {
      setLoading(true)
      try {
        const res = await listInfos(sessionId)
        if (!mounted) return
        setInfosMap((prev) => ({ ...prev, [sessionId]: res.infos }))
      } finally {
        setLoading(false)
      }
    }
    fetchInfos()
    return () => {
      mounted = false
    }
  }, [sessionId, setInfosMap])

  const toggle = (id: string) => {
    const next = { ...selectedReferences }
    if (next[id]) {
      delete next[id]
    } else {
      next[id] = ''
    }
    onReferencesChange(next)
  }

  const setReason = (id: string, reason: string) => {
    const next = { ...selectedReferences, [id]: reason }
    onReferencesChange(next)
  }

  return (
    <div className="text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-semibold">引用 Info</span>
        {loading && <span className="text-slate-500">加载中...</span>}
      </div>
      <div className="scroll-area" style={{ maxHeight: 140 }}>
        {infos.map((info) => {
          const checked = Object.prototype.hasOwnProperty.call(selectedReferences, info.id)
          return (
            <label key={info.id} className="flex items-start gap-2 mb-2">
              <input type="checkbox" checked={checked} onChange={() => toggle(info.id)} />
              <div className="flex-1">
                <div className="font-medium">{info.name}</div>
                <div className="text-slate-500 text-[11px]">{info.description}</div>
                {checked && (
                  <input
                    className="input mt-1 text-xs"
                    placeholder="引用理由（可选）"
                    value={selectedReferences[info.id] || ''}
                    onChange={(e) => setReason(info.id, e.target.value)}
                  />
                )}
              </div>
            </label>
          )
        })}
        {infos.length === 0 && <div className="text-slate-500">暂无可引用 Info</div>}
      </div>
    </div>
  )
}

