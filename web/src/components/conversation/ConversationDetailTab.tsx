// Conversation 详情视图。
import { useAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Tag from '../common/Tag'
import { conversationDetailsAtom, infosBySessionAtom } from '../../atoms'
import { answer, getConversation, listInfos } from '../../api/client'
import ReferenceList from '../info/ReferenceList'
import ManualThinkResponder from './ManualThinkResponder'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { LuMessageSquare, LuBrainCircuit, LuTerminal, LuCircleHelp, LuCheck, LuArrowUpRight } from 'react-icons/lu'
import type { InfoListItem } from '../../types/api'

interface Props {
  sessionId: string
  conversationId: string
  onClose: () => void
  onOpenConversation?: (id: string) => void
}

const statusColor: Record<string, string> = {
  running: '#2563eb',
  waiting_answer: '#eab308',
  waiting_respond: '#8b5cf6',
  waiting_manual_think: '#f97316',
  completed: '#16a34a',
  error: '#ef4444',
}

export default function ConversationDetailTab({ sessionId, conversationId, onClose, onOpenConversation }: Props) {
  const [detailMap, setDetailMap] = useAtom(conversationDetailsAtom)
  const [infosMap, setInfosMap] = useAtom(infosBySessionAtom)
  const [loading, setLoading] = useState(false)
  const detail = detailMap[conversationId]
  const infos: InfoListItem[] = infosMap[sessionId] || []

  const refresh = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await getConversation(sessionId, conversationId)
      setDetailMap((prev) => ({ ...prev, [conversationId]: res }))
    } finally {
      setLoading(false)
    }
  }, [sessionId, conversationId, setDetailMap])

  // 需要引用 Info 时提前加载
  useEffect(() => {
    let mounted = true
    if (!sessionId || infos.length > 0) return
    const load = async () => {
      try {
        const res = await listInfos(sessionId)
        if (!mounted) return
        setInfosMap((prev) => ({ ...prev, [sessionId]: res.infos }))
      } catch {
        // ignore
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [sessionId, infos.length, setInfosMap])

  useAutoRefresh(refresh, 2000, Boolean(sessionId))

  if (!detail) {
    return (
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold">对话详情</h4>
          <button className="btn-secondary text-xs" onClick={onClose}>
            关闭
          </button>
        </div>
        {loading ? '加载中...' : '暂无数据'}
      </div>
    )
  }

  const statusBg = `${statusColor[detail.status] || '#6b7280'}22`
  const statusBorder = `${statusColor[detail.status] || '#6b7280'}55`
  const statusText = statusColor[detail.status] || '#374151'

  return (
    <div className="flex flex-1 flex-col gap-4 scroll-area p-2">
      <div className="flex flex-col gap-2">
        {detail.title && <h1 className="text-xl font-bold text-slate-800">{detail.title}</h1>}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Tag>ID: {detail.id}</Tag>
          <Tag>From: {detail.from}</Tag>
          <Tag>To: {detail.to}</Tag>
          <Tag bg={statusBg} border={statusBorder} color={statusText}>
            状态: {detail.status}
          </Tag>
        </div>
        {detail.desc && <p className="text-sm text-slate-500">{detail.desc}</p>}
      </div>

      <div className="card">
        <div className="text-xs text-slate-500 font-bold pb-1">Request</div>
        <div className="text-sm whitespace-pre-wrap">{detail.request.content}</div>
        {detail.request.references && Object.keys(detail.request.references).length > 0 && (
          <ReferenceList references={detail.request.references} />
        )}
      </div>

      <div className="card">
        <div className="text-xs text-slate-500 font-bold pb-1">Response</div>
        <div className="text-sm whitespace-pre-wrap">{detail.response.content}</div>
        {detail.response.references && Object.keys(detail.response.references).length > 0 && (
          <ReferenceList references={detail.response.references} />
        )}
      </div>

      {detail.activities.length > 0 && (
        <div className="card">
          <div className="font-semibold mb-4">Activities</div>
          <div className="relative flex flex-col gap-0 pl-2">
            {/* Vertical line background */}
            <div className="absolute left-[19px] top-2 bottom-4 w-[2px] bg-slate-100" />
            
            {detail.activities.map((a, idx) => {
              const question =
                a.typ === 'ask' && a.question_id
                  ? detail.questions.find((q) => q.id === a.question_id)
                  : undefined
              
              let Icon = LuCheck
              let bg = 'bg-slate-100'
              let iconColor = 'text-slate-500'
              
              switch (a.typ) {
                case 'talk':
                  Icon = LuMessageSquare
                  bg = 'bg-blue-100'
                  iconColor = 'text-blue-600'
                  break
                case 'focus':
                  Icon = LuBrainCircuit
                  bg = 'bg-purple-100'
                  iconColor = 'text-purple-600'
                  break
                case 'act':
                  Icon = LuTerminal
                  bg = 'bg-slate-800'
                  iconColor = 'text-white'
                  break
                case 'ask':
                  Icon = LuCircleHelp
                  bg = 'bg-amber-100'
                  iconColor = 'text-amber-600'
                  break
              }

              return (
                <div key={`${a.typ}-${idx}`} className="relative flex gap-4 pb-6 last:pb-0 group">
                  {/* Icon */}
                  <div className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-full ${bg} flex items-center justify-center border-2 border-white shadow-sm`}>
                    <Icon className={iconColor} size={16} />
                  </div>
                  
                  {/* Content */}
                  <div className="flex-1 pt-1">
                    {a.typ === 'talk' && (
                      <div>
                        <div className="text-sm font-medium text-slate-700">Talk</div>
                        <div className="text-xs text-slate-500 mt-1">→ Conversation {a.conversation_id}</div>
                        {a.conversation && (
                          <div className="mt-2 bg-blue-50 border border-blue-100 rounded p-2 text-xs">
                            <div className="font-semibold text-blue-700 mb-1">{a.conversation.title || 'Untitled'}</div>
                            {a.conversation.desc && <div className="text-slate-600 mb-1">{a.conversation.desc}</div>}
                            <div className="flex gap-2 mb-2">
                              <span className={`px-1.5 py-0.5 rounded bg-white border ${a.conversation.status === 'error' ? 'border-red-200 text-red-600' : 'border-slate-200 text-slate-500'}`}>
                                {a.conversation.status}
                              </span>
                            </div>
                            {a.conversation.request?.content && (
                              <div className="mb-1">
                                <span className="text-slate-400 font-bold text-[10px] uppercase">Request</span>
                                <div className="text-slate-700 line-clamp-2">{a.conversation.request.content}</div>
                              </div>
                            )}
                            {a.conversation.response?.content && (
                              <div>
                                <span className="text-slate-400 font-bold text-[10px] uppercase">Response</span>
                                <div className="text-slate-700 line-clamp-2">{a.conversation.response.content}</div>
                              </div>
                            )}
                            {a.conversation_id && (
                              <button
                                className="btn-secondary mt-2 text-xs inline-flex items-center gap-1"
                                onClick={() => onOpenConversation?.(a.conversation_id!)}
                              >
                                查看详情 <LuArrowUpRight size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {a.typ === 'focus' && (
                      <div>
                        <div className="text-sm font-medium text-slate-700">Focus</div>
                        <div className="text-xs text-slate-500 mt-1">→ Conversation {a.conversation_id}</div>
                        {a.conversation && (
                          <div className="mt-2 bg-purple-50 border border-purple-100 rounded p-2 text-xs">
                            <div className="font-semibold text-purple-700 mb-1">{a.conversation.title || 'Untitled'}</div>
                            {a.conversation.desc && <div className="text-slate-600 mb-1">{a.conversation.desc}</div>}
                            <div className="flex gap-2 mb-2">
                              <span className={`px-1.5 py-0.5 rounded bg-white border ${a.conversation.status === 'error' ? 'border-red-200 text-red-600' : 'border-slate-200 text-slate-500'}`}>
                                {a.conversation.status}
                              </span>
                            </div>
                            {a.conversation.request?.content && (
                              <div className="mb-1">
                                <span className="text-slate-400 font-bold text-[10px] uppercase">Request</span>
                                <div className="text-slate-700 line-clamp-2">{a.conversation.request.content}</div>
                              </div>
                            )}
                            {a.conversation.response?.content && (
                              <div>
                                <span className="text-slate-400 font-bold text-[10px] uppercase">Response</span>
                                <div className="text-slate-700 line-clamp-2">{a.conversation.response.content}</div>
                              </div>
                            )}
                            {a.conversation_id && (
                              <button
                                className="btn-secondary mt-2 text-xs inline-flex items-center gap-1"
                                onClick={() => onOpenConversation?.(a.conversation_id!)}
                              >
                                查看详情 <LuArrowUpRight size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {a.typ === 'act' && (
                      <div className="w-full">
                        <div className="text-sm font-medium text-slate-700 flex items-center gap-2">
                          <span>Act</span>
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono border border-slate-200">
                            {a.object}::{a.method}
                          </span>
                        </div>
                        {(a.request??undefined) && (
                          <div className="mt-2 bg-slate-50 rounded border border-slate-200 p-2 overflow-x-auto">
                            <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider font-bold">Params</div>
                            <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono break-all">
                              {JSON.stringify(a.request, null, 2)}
                            </pre>
                          </div>
                        )}
                        {a.response?.content && (
                          <div className="mt-2">
                            <div className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider font-bold">Result</div>
                            <div className="text-xs text-slate-600 bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap break-all">
                              {a.response.content}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {a.typ === 'ask' && (
                      <div>
                        <div className="text-sm font-medium text-slate-700">Ask <span className="text-slate-400 font-normal text-xs ml-1">Q{a.question_id}</span></div>
                        {question && (
                          <div className="mt-1 text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded p-2">
                            {question.question.content}
                          </div>
                        )}
                        {question?.answer?.content && (
                          <div className="mt-2 flex items-start gap-2">
                            <div className="text-xs font-bold text-emerald-600 mt-0.5">A:</div>
                            <div className="text-sm text-slate-700">{question.answer.content}</div>
                          </div>
                        )}
                        {!question?.answer?.content && (
                          <div className="mt-3">
                            <AnswerBox
                              sessionId={sessionId}
                              conversationId={conversationId}
                              questionId={question?.id || a.question_id!}
                              infos={infos}
                              onSubmitted={refresh}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ManualThinkResponder sessionId={sessionId} conversation={detail} onSubmitted={refresh} />
    </div>
  )
}

function AnswerBox({
  sessionId,
  conversationId,
  questionId,
  infos,
  onSubmitted,
}: {
  sessionId: string
  conversationId: string
  questionId: number
  infos: InfoListItem[]
  onSubmitted: () => void
}) {
  const [content, setContent] = useState('')
  const [references, setReferences] = useState<Record<string, string>>({})
  const [showInfoPicker, setShowInfoPicker] = useState(false)
  const [searchInfo, setSearchInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('请输入回复内容')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await answer(sessionId, {
        conversation_id: conversationId,
        question_id: questionId,
        answer: content.trim(),
        references,
      })
      setContent('')
      setReferences({})
      setShowInfoPicker(false)
      onSubmitted()
    } catch (e) {
      setError((e as Error).message || '提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card border border-amber-200 bg-white shadow-sm p-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">回复问题</span>
        <button
          type="button"
          className="btn-secondary text-2xs"
          style={{ padding: '3px 8px', borderRadius: '10px' }}
          onClick={() => setShowInfoPicker((v) => !v)}
        >
          @ 引用 Info ({Object.keys(references).length})
        </button>
      </div>
      <textarea
        className="input text-sm"
        rows={3}
        placeholder="请输入回复"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        style={{ minHeight: '78px' }}
      />

      {showInfoPicker && (
        <div className="card mt-2" style={{ maxHeight: '220px', overflow: 'hidden' }}>
          <input
            className="input text-xs mb-2"
            placeholder="搜索 Info（ID/名称/描述）"
            value={searchInfo}
            onChange={(e) => setSearchInfo(e.target.value)}
          />
          <div className="scroll-area" style={{ maxHeight: '150px' }}>
            {filteredInfos.map((info) => {
              const active = references[info.id] !== undefined
              return (
                <div
                  key={info.id}
                  className="flex items-start gap-2 p-2 rounded cursor-pointer"
                  style={{ background: active ? 'rgba(37, 99, 235, 0.08)' : 'transparent' }}
                  onClick={() => toggleReference(info.id)}
                >
                  <div className="text-xs font-semibold">{active ? '✓' : '@'}</div>
                  <div className="flex-1 text-xs">
                    <div className="font-medium">{info.name}</div>
                    <div className="text-slate-500 text-[11px] break-words">{info.description}</div>
                    <div className="text-[10px] text-slate-400 mt-1">{info.id}</div>
                  </div>
                </div>
              )
            })}
            {filteredInfos.length === 0 && <div className="text-xs text-slate-500 p-2">无匹配 Info</div>}
          </div>
        </div>
      )}

      {error && <div className="text-xs text-red-500 mt-1">{error}</div>}

      <div className="mt-2 flex items-center gap-2">
        <button
          className="btn-primary text-xs"
          style={{ padding: '6px 12px', borderRadius: '10px' }}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? '提交中...' : '提交回复'}
        </button>
        <button
          className="btn-secondary text-xs"
          style={{ padding: '6px 10px', borderRadius: '10px' }}
          onClick={() => {
            setContent('')
            setReferences({})
            setShowInfoPicker(false)
            setError(null)
          }}
        >
          重置
        </button>
      </div>
    </div>
  )
}

