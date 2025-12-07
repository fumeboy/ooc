// 处理等待手动思考的表单。
import { useAtom } from 'jotai'
import { useEffect, useState } from 'react'
import {
  manualThinkMethodByConversationAtom,
  manualThinkParamsByConversationAtom,
  submittingManualThinkByConversationAtom,
} from '../../atoms'
import { respondManualThink } from '../../api/client'
import type { ConversationResponse } from '../../types/api'

interface Props {
  sessionId: string
  conversation: ConversationResponse
  onSubmitted?: () => void
}

export default function ManualThinkResponder({ sessionId, conversation, onSubmitted }: Props) {
  const [methodMap, setMethodMap] = useAtom(manualThinkMethodByConversationAtom)
  const [paramsMap, setParamsMap] = useAtom(manualThinkParamsByConversationAtom)
  const [submittingMap, setSubmittingMap] = useAtom(submittingManualThinkByConversationAtom)
  const [error, setError] = useState<string | null>(null)

  const waiting = conversation.waiting_manual_think_request
  const convId = conversation.id

  useEffect(() => {
    if (!waiting) return
    setMethodMap((prev) => ({ ...prev, [convId]: waiting.llm_method || '' }))
    setParamsMap((prev) => ({ ...prev, [convId]: JSON.stringify(waiting.llm_params ?? {}, null, 2) }))
  }, [waiting, convId, setMethodMap, setParamsMap])

  if (!waiting) return null

  const method = methodMap[convId] || ''
  const params = paramsMap[convId] || ''
  const submitting = submittingMap[convId] || false

  const submit = async () => {
    try {
      setSubmittingMap((prev) => ({ ...prev, [convId]: true }))
      setError(null)
      const parsed = params ? JSON.parse(params) : {}
      await respondManualThink(sessionId, {
        conversation_id: convId,
        method,
        parameters: parsed,
      })
      onSubmitted?.()
    } catch (err) {
      setError((err as Error).message || '提交失败')
    } finally {
      setSubmittingMap((prev) => ({ ...prev, [convId]: false }))
    }
  }

  return (
    <div className="card mt-3" style={{ padding: '14px' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-blue-500 text-lg">🧠</span>
          <div className="font-semibold">等待手动思考</div>
        </div>
        <span className="text-xs text-slate-500">会话：{conversation.id}</span>
      </div>

      <div className="flex gap-4 flex-col md:flex-row">
        <div className="flex-1 space-y-3">
          <div>
            <div className="text-xs text-slate-500 font-semibold mb-1">Prompt</div>
            <pre
              className="text-xs bg-slate-100 p-3 rounded whitespace-pre-wrap"
              style={{ border: '1px solid var(--border-color)', minHeight: '120px' }}
            >
{waiting.prompt}
            </pre>
          </div>
          {waiting.tools && waiting.tools.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">可用工具</span>
              {waiting.tools.map((tool) => (
                <span
                  key={tool}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '8px',
                    background: '#bdbdbd17',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {tool}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div className="text-xs text-slate-500 font-semibold">方法</div>
          <input
            className="input"
            placeholder="方法名"
            value={method}
            onChange={(e) => setMethodMap((prev) => ({ ...prev, [convId]: e.target.value }))}
          />
          <div className="text-xs text-slate-500 font-semibold">参数 (JSON)</div>
          <textarea
            className="input"
            rows={8}
            placeholder="参数（JSON）"
            value={params}
            onChange={(e) => setParamsMap((prev) => ({ ...prev, [convId]: e.target.value }))}
          />
          {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
          <button className="btn-primary w-full" onClick={submit} disabled={submitting}>
            {submitting ? '提交中...' : '提交手动思考'}
          </button>
        </div>
      </div>
    </div>
  )
}

