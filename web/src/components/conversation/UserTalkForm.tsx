// User 发起 Talk 的表单：固定底部、玻璃态、支持 @ Info 选择。
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import { talk, listInfos } from '../../api/client'
import { infosBySessionAtom } from '../../atoms'
import type { InfoListItem } from '../../types/api'

interface Props {
  sessionId: string
  onSent?: () => void
}

export default function UserTalkForm({ sessionId, onSent }: Props) {
  const [content, setContent] = useState('')
  const [talkWith, setTalkWith] = useState('system::system')
  const [title, setTitle] = useState('')
  const [references, setReferences] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInfoPicker, setShowInfoPicker] = useState(false)
  const [showTalkWithPicker, setShowTalkWithPicker] = useState(false)
  const [searchInfo, setSearchInfo] = useState('')
  const [searchTalkWith, setSearchTalkWith] = useState('')
  const [infosMap, setInfosMap] = useAtom(infosBySessionAtom)

  const infos: InfoListItem[] = infosMap[sessionId] || []

  useEffect(() => {
    let mounted = true
    if (!(showInfoPicker || showTalkWithPicker) || !sessionId || infos.length > 0) return
    const load = async () => {
      try {
        const res = await listInfos(sessionId)
        if (!mounted) return
        setInfosMap((prev) => ({ ...prev, [sessionId]: res.infos }))
      } catch {
        // ignore fetch error in picker
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [showInfoPicker, sessionId, infos.length, setInfosMap])

  const filteredInfos = useMemo(() => {
    const term = searchInfo.trim().toLowerCase()
    if (!term) return infos
    return infos.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        i.description.toLowerCase().includes(term) ||
        i.id.toLowerCase().includes(term)
    )
  }, [infos, searchInfo])

  const filteredTalkTargets = useMemo(() => {
    const defaults: InfoListItem[] = [{ id: 'system::system', name: 'System', description: '系统', class: 'system' }]
    const pool = [...defaults, ...infos]
    const term = searchTalkWith.trim().toLowerCase()
    if (!term) return pool
    return pool.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        i.description.toLowerCase().includes(term) ||
        i.id.toLowerCase().includes(term)
    )
  }, [infos, searchTalkWith])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!content.trim()) {
      setError('请输入内容')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await talk(sessionId, { content, talk_with: talkWith, title, references })
      setContent('')
      setReferences({})
      setShowInfoPicker(false)
      onSent?.()
    } catch (err) {
      setError((err as Error).message || '发送失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleReference = (id: string) => {
    setReferences((prev) => {
      const next = { ...prev }
      if (next[id] !== undefined) {
        delete next[id]
      } else {
        next[id] = ''
      }
      return next
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: '22px',
        width: 'min(880px, 94%)',
        background: 'var(--bg-soft)',
        backdropFilter: 'blur(18px) saturate(150%)',
        border: '1px solid #ddd',
        borderRadius: '12px',
        boxShadow: '0 2px 2px rgba(0,0,0,0.10)',
        zIndex: 5,
      }}
      className="talk-form p-1"
    >
      <div className="flex items-center gap-2 mb-2 flex-wrap px-3">
        <span aria-hidden style={{ fontSize: '16px' }}>💬</span>
        <h4 className="font-semibold text-sm">Talk</h4>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn-secondary text-xs"
            style={{ padding: '4px 12px', borderRadius: '10px' }}
            onClick={() => {
              setShowTalkWithPicker((v) => !v)
              setShowInfoPicker(false)
            }}
          >
            对象：{talkWith}
          </button>
          {showTalkWithPicker && (
            <div
              className="card"
              style={{
                position: 'absolute',
                left: 0,
                top: '110%',
                width: '320px',
                maxHeight: '260px',
                overflow: 'hidden',
                zIndex: 12,
              }}
            >
              <input
                className="input text-sm mb-2"
                placeholder="搜索对象"
                value={searchTalkWith}
                onChange={(e) => setSearchTalkWith(e.target.value)}
              />
              <div className="scroll-area" style={{ maxHeight: '200px' }}>
                {filteredTalkTargets.map((info) => {
                  const active = talkWith === info.id
                  return (
                    <div
                      key={info.id}
                      className="flex items-start gap-2 p-2 rounded cursor-pointer"
                      style={{
                        background: active ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                      }}
                      onClick={() => {
                        setTalkWith(info.id)
                        setShowTalkWithPicker(false)
                      }}
                    >
                      <div className="text-xs font-semibold">{active ? '✓' : '·'}</div>
                      <div className="flex-1 text-sm">
                        <div className="font-medium">{info.name}</div>
                        <div className="text-slate-500 text-xs break-words">{info.description}</div>
                        <div className="text-[11px] text-slate-400 mt-1">{info.id}</div>
                      </div>
                    </div>
                  )
                })}
                {filteredTalkTargets.length === 0 && <div className="text-xs text-slate-500 p-2">无匹配对象</div>}
              </div>
            </div>
          )}
        </div>
        <input
          className="input text-xs flex-1"
          placeholder="标题（可选）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ height: '30px', padding: '4px 10px' }}
        />
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            className="btn-secondary text-xs"
            style={{ padding: '4px 12px', borderRadius: '10px' }}
            onClick={() => {
              setShowInfoPicker((v) => !v)
              setShowTalkWithPicker(false)
            }}
          >
            @ 引用 Info ({Object.keys(references).length})
          </button>
          <button
            className="btn-primary text-xs"
            type="submit"
            disabled={loading}
            style={{ padding: '4px 14px', borderRadius: '10px' }}
          >
            {loading ? '发送中...' : '发送'}
          </button>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <textarea
          className="input"
          rows={4}
          placeholder="内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{
            height: '100px',
            border: 'none',
            outline: 'none',
            background: 'rgba(255,255,255,0.6)',
          }}
        />

        {showInfoPicker && (
          <div
            className="card"
            style={{
              position: 'absolute',
              left: '0',
              bottom: '54px',
              width: '320px',
              maxHeight: '260px',
              overflow: 'hidden',
              zIndex: 10,
            }}
          >
            <input
              className="input text-sm mb-2"
              placeholder="搜索 Info（ID/名称/描述）"
              value={searchInfo}
              onChange={(e) => setSearchInfo(e.target.value)}
            />
            <div className="scroll-area" style={{ maxHeight: '200px' }}>
              {filteredInfos.map((info) => {
                const active = references[info.id] !== undefined
                return (
                  <div
                    key={info.id}
                    className="flex items-start gap-2 p-2 rounded cursor-pointer"
                    style={{
                      background: active ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                    }}
                    onClick={() => toggleReference(info.id)}
                  >
                    <div className="text-xs font-semibold">{active ? '✓' : '@'}</div>
                    <div className="flex-1 text-sm">
                      <div className="font-medium">{info.name}</div>
                      <div className="text-slate-500 text-xs break-words">{info.description}</div>
                      <div className="text-[11px] text-slate-400 mt-1">{info.id}</div>
                    </div>
                  </div>
                )
              })}
              {filteredInfos.length === 0 && <div className="text-xs text-slate-500 p-2">无匹配 Info</div>}
            </div>
          </div>
        )}
      </div>

      {error && <div className="text-red-500 text-xs mt-2">{error}</div>}
    </form>
  )
}

