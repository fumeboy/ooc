import { useState, useEffect } from 'react'
import { sessionApi, possessApi } from '../../api/client'
import type { GetPossessRequestResponse } from '../../types/api'
import InfoReferenceSelector from '../InfoReferenceSelector'

interface LLMRequestsTabProps {
  sessionId: string
}

export default function LLMRequestsTab({ sessionId }: LLMRequestsTabProps) {
  const [possessRequest, setPossessRequest] = useState<GetPossessRequestResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [response, setResponse] = useState({ method: '', parameters: '' })
  const [lastFilledMethod, setLastFilledMethod] = useState<string | null>(null)
  const [references, setReferences] = useState<Record<string, string>>({})

  const refresh = async () => {
    setLoading(true)
    try {
      const session = await sessionApi.get(sessionId)
      if (session.possessed) {
        const request = await possessApi.getRequest(sessionId)
        setPossessRequest(request)
      } else {
        setPossessRequest(null)
      }
    } catch (error) {
      console.error('Failed to fetch possess request:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 2000) // 每2秒刷新一次
    return () => clearInterval(interval)
  }, [sessionId])

  // 当获取到新的 possessRequest 时，自动填充 LLM 的输出到表单
  // 只在首次获取或请求发生变化时填充，避免覆盖用户正在编辑的内容
  useEffect(() => {
    if (
      possessRequest?.has_request &&
      possessRequest.llm_method &&
      possessRequest.llm_method !== lastFilledMethod
    ) {
      setResponse({
        method: possessRequest.llm_method,
        parameters: possessRequest.llm_params
          ? JSON.stringify(possessRequest.llm_params, null, 2)
          : '{}',
      })
      setLastFilledMethod(possessRequest.llm_method)
    }
  }, [possessRequest, lastFilledMethod])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!response.method.trim()) return

    setSubmitting(true)
    try {
      let parameters: any
      try {
        parameters = JSON.parse(response.parameters || '{}')
      } catch {
        parameters = {}
      }

      // 如果 method 是 talk，将 references 合并到 parameters 中
      if (response.method === 'talk' && Object.keys(references).length > 0) {
        if (!parameters.references) {
          parameters.references = {}
        }
        Object.assign(parameters.references, references)
      }

      await possessApi.respond(sessionId, {
        method: response.method,
        parameters,
      })

      setResponse({ method: '', parameters: '' })
      setLastFilledMethod(null)
      setReferences({})
      await refresh()
    } catch (error) {
      console.error('Failed to respond possess request:', error)
      alert('回复失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !possessRequest) {
    return <div className="tab-loading">加载中...</div>
  }

  if (!possessRequest || !possessRequest.has_request) {
    return (
      <div className="llm-requests-tab">
        <div className="tab-header">
          <button onClick={refresh} disabled={loading} className="refresh-button">
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
        <div className="tab-empty">暂无 LLM 请求</div>
      </div>
    )
  }

  return (
    <div className="llm-requests-tab">
      <div className="tab-header">
        <button onClick={refresh} disabled={loading} className="refresh-button">
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>
      <div className="llm-requests-content">
        <div className="llm-requests-prompt">
          <strong>Prompt:</strong>
          <pre>{possessRequest.prompt}</pre>
        </div>
        {possessRequest.tools && possessRequest.tools.length > 0 && (
          <div className="llm-requests-tools">
            <strong>Tools:</strong>
            <ul>
              {possessRequest.tools.map((tool, idx) => (
                <li key={idx}>{tool}</li>
              ))}
            </ul>
          </div>
        )}
        {possessRequest.llm_method && (
          <div className="llm-requests-llm-output">
            <strong>LLM 输出:</strong>
            <div className="llm-requests-llm-method">
              <span className="llm-requests-label">Method:</span>
              <code>{possessRequest.llm_method}</code>
            </div>
            {possessRequest.llm_params && (
              <div className="llm-requests-llm-params">
                <span className="llm-requests-label">Parameters:</span>
                <pre>{JSON.stringify(possessRequest.llm_params, null, 2)}</pre>
              </div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className="llm-requests-form">
          <div className="llm-requests-form-field">
            <label>Method:</label>
            <input
              type="text"
              value={response.method}
              onChange={(e) => setResponse({ ...response, method: e.target.value })}
              placeholder="输入 method 名称"
              disabled={submitting}
              required
            />
          </div>
          <div className="llm-requests-form-field">
            <label>Parameters (JSON):</label>
            <textarea
              value={response.parameters}
              onChange={(e) => setResponse({ ...response, parameters: e.target.value })}
              placeholder='{"key": "value"}'
              rows={5}
              disabled={submitting}
            />
          </div>
          <InfoReferenceSelector
            sessionId={sessionId}
            selectedReferences={references}
            onReferencesChange={setReferences}
          />
          <button type="submit" disabled={submitting || !response.method.trim()} className="llm-requests-submit">
            {submitting ? '提交中...' : '提交回复'}
          </button>
        </form>
      </div>
    </div>
  )
}

