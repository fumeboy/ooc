import { useState, useEffect, useRef, useMemo } from 'react'
import { conversationApi, manualThinkApi } from '../../api/client'
import type { Conversation } from '../../types/api'
import ReferenceList from '../ReferenceList'

interface ConversationDetailTabProps {
  sessionId: string
  conversationId: string
  onClose: () => void
}

export default function ConversationDetailTab({ sessionId, conversationId, onClose }: ConversationDetailTabProps) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(false)
  const [manualThinkMethod, setManualThinkMethod] = useState('')
  const [manualThinkParams, setManualThinkParams] = useState('')
  const [submittingManualThink, setSubmittingManualThink] = useState(false)
  
  // 使用 ref 来跟踪用户是否正在编辑表单，避免刷新时覆盖用户输入
  const isEditingRef = useRef(false)
  const lastManualThinkRequestRef = useRef<string>('')
  const contentRef = useRef<HTMLDivElement>(null)
  const lastUpdatedAtRef = useRef<string>('') // 记录上次的 updated_at 值

  const loadConversation = async (isFirstLoad?:boolean) => {
    // 如果用户正在编辑，跳过刷新
    if (isEditingRef.current) {
      return
    }

    
    // 只在首次加载时设置 loading，避免每次刷新都闪烁
    if (isFirstLoad) {
      setLoading(true)
    }
    
    try {
      const conv = await conversationApi.get(sessionId, conversationId)
      
      // 比较 updated_at，如果没变化则直接返回，不更新状态
      if (conv.updated_at && conv.updated_at === lastUpdatedAtRef.current) {
        // updated_at 没变化，说明数据没有更新，直接返回
        if (isFirstLoad) {
          setLoading(false)
        }
        return
      }
      
      // updated_at 有变化，更新记录
      lastUpdatedAtRef.current = conv.updated_at || ''
      
      setConversation(conv)
      
      // 如果是 waiting_manual_think 状态，从 conversation 中获取 manual think request
      // 只在请求真正变化时才更新表单（避免覆盖用户正在编辑的内容）
      if (conv.status === 'waiting_manual_think' && conv.waiting_manual_think_request) {
      } else {
        lastManualThinkRequestRef.current = ''
      }
      
      // 只在首次加载时设置 loading 为 false
      if (isFirstLoad) {
        setLoading(false)
      }
    } catch (error) {
      console.error('Failed to fetch conversation:', error)
      if (isFirstLoad) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadConversation(true)
    const interval = setInterval(loadConversation, 2000) // 每2秒刷新一次
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, conversationId])
  
  // 监听用户输入，标记为正在编辑
  useEffect(() => {
    if (manualThinkMethod || manualThinkParams) {
      isEditingRef.current = true
      const timer = setTimeout(() => {
        isEditingRef.current = false
      }, 1000) // 用户停止输入1秒后，允许刷新
      return () => clearTimeout(timer)
    } else {
      isEditingRef.current = false
    }
  }, [manualThinkMethod, manualThinkParams])
  // 使用 useMemo 缓存 references 对象，避免每次渲染都创建新对象
  // 通过序列化来比较是否变化，而不是直接比较对象引用
  const requestReferencesKey = useMemo(() => {
    if (!conversation?.request.references) return ''
    return JSON.stringify(conversation.request.references)
  }, [conversation?.request.references])
  
  const requestReferences = useMemo(() => conversation?.request.references, [requestReferencesKey])
  
  const responseReferencesKey = useMemo(() => {
    if (!conversation?.response.references) return ''
    return JSON.stringify(conversation.response.references)
  }, [conversation?.response.references])
  
  const responseReferences = useMemo(() => conversation?.response.references, [responseReferencesKey])

  // 使用 useMemo 缓存 questions 和 actions 的渲染结果
  // 通过序列化 questions 和 actions 来比较是否变化
  const questionsKey = useMemo(() => {
    if (!conversation || conversation.questions.length === 0) return ''
    return conversation.questions.map(q => 
      `${q.id}:${q.question.content}:${q.answer.content || ''}`
    ).join('|')
  }, [conversation?.questions])

  const questionsList = useMemo(() => {
    if (!conversation || conversation.questions.length === 0) return null
    return conversation.questions.map((q) => (
      <div key={q.id} className="conversation-detail-question">
        <div className="conversation-detail-question-header">
          <span>Q{q.id}:</span>
          <div>{q.question.content}</div>
        </div>
        {q.answer.content && (
          <div className="conversation-detail-question-answer">
            <span>A:</span>
            <div>{q.answer.content}</div>
          </div>
        )}
      </div>
    ))
  }, [questionsKey])

  const actionsKey = useMemo(() => {
    if (!conversation || conversation.actions.length === 0) return ''
    return conversation.actions.map((action, idx) => 
      `${idx}:${action.typ}:${action.conversation_id || ''}:${action.object || ''}:${action.method || ''}:${action.response?.content || ''}`
    ).join('|')
  }, [conversation?.actions])

  const actionsList = useMemo(() => {
    if (!conversation || conversation.actions.length === 0) return null
    return conversation.actions.map((action, idx) => (
      <div key={idx} className="conversation-detail-action">
        <div className="conversation-detail-action-type">Type: {action.typ}</div>
        {action.typ === 'talk' && action.conversation_id && (
          <div className="conversation-detail-action-info">
            Conversation ID: {action.conversation_id}
          </div>
        )}
        {action.typ === 'act' && (
          <>
            <div className="conversation-detail-action-info">
              Object: {action.object}
            </div>
            <div className="conversation-detail-action-info">
              Method: {action.method}
            </div>
            {action.response?.content && (
              <div className="conversation-detail-action-response">
                Response: {action.response.content}
              </div>
            )}
          </>
        )}
      </div>
    ))
  }, [actionsKey])

  const handleSubmitManualThink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualThinkMethod.trim()) return

    setSubmittingManualThink(true)
    try {
      let parameters: any
      try {
        parameters = JSON.parse(manualThinkParams || '{}')
      } catch {
        parameters = {}
      }

      await manualThinkApi.respond(sessionId, {
        conversation_id: conversationId,
        method: manualThinkMethod,
        parameters,
      })

      setManualThinkMethod('')
      setManualThinkParams('')
      lastManualThinkRequestRef.current = ''
      isEditingRef.current = false
      await loadConversation()
    } catch (error) {
      console.error('Failed to respond manual think:', error)
      alert('回复失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setSubmittingManualThink(false)
    }
  }

  // 使用 useMemo 缓存 conversation 的基本信息，避免每次渲染都重新计算
  const conversationIdDisplay = useMemo(() => conversation?.id || '', [conversation?.id])
  const conversationTitle = useMemo(() => conversation?.title, [conversation?.title])
  const conversationDesc = useMemo(() => conversation?.desc, [conversation?.desc])
  const conversationFrom = useMemo(() => conversation?.from || '', [conversation?.from])
  const conversationTo = useMemo(() => conversation?.to || '', [conversation?.to])
  const conversationStatus = useMemo(() => conversation?.status || '', [conversation?.status])
  const conversationRequestContent = useMemo(() => conversation?.request.content, [conversation?.request.content])
  const conversationResponseContent = useMemo(() => conversation?.response.content, [conversation?.response.content])
  const waitingManualThinkRequest = useMemo(() => conversation?.waiting_manual_think_request, [conversation?.waiting_manual_think_request])

  if (loading) {
    return <div className="tab-loading">加载中...</div>
  }

  if (!conversation) {
    return <div className="tab-empty">Conversation 不存在</div>
  }

  return (
    <div className="conversation-detail-tab">
      <div className="conversation-detail-header">
        <button onClick={onClose} className="conversation-detail-close">×</button>
        <h3 className="conversation-detail-title">Conversation: {conversationIdDisplay}</h3>
      </div>
      <div ref={contentRef} className="conversation-detail-content">
        {conversationTitle && (
          <div className="conversation-detail-section">
            <strong>Title:</strong>
            <div>{conversationTitle}</div>
          </div>
        )}
        {conversationDesc && (
          <div className="conversation-detail-section">
            <strong>Description:</strong>
            <div>{conversationDesc}</div>
          </div>
        )}
        <div className="conversation-detail-section">
          <strong>From:</strong>
          <div>{conversationFrom}</div>
        </div>
        <div className="conversation-detail-section">
          <strong>To:</strong>
          <div>{conversationTo}</div>
        </div>
        <div className="conversation-detail-section">
          <strong>Status:</strong>
          <div className={`conversation-detail-status status-${conversationStatus}`}>
            {conversationStatus}
          </div>
        </div>
        {conversationRequestContent && (
          <div className="conversation-detail-section">
            <strong>Request:</strong>
            <div className="conversation-detail-text">{conversationRequestContent}</div>
            {requestReferences && Object.keys(requestReferences).length > 0 && (
              <div className="conversation-detail-references">
                <strong>引用:</strong>
                <ReferenceList 
                  sessionId={sessionId} 
                  references={requestReferences}
                  onViewConversation={()=>{}}
                />
              </div>
            )}
          </div>
        )}
        {conversationResponseContent && (
          <div className="conversation-detail-section">
            <strong>Response:</strong>
            <div className="conversation-detail-text">{conversationResponseContent}</div>
            {responseReferences && Object.keys(responseReferences).length > 0 && (
              <div className="conversation-detail-references">
                <strong>引用:</strong>
                <ReferenceList 
                  sessionId={sessionId} 
                  references={responseReferences}
                  onViewConversation={()=>{}}
                />
              </div>
            )}
          </div>
        )}
        {questionsList && (
          <div className="conversation-detail-section">
            <strong>Questions:</strong>
            {questionsList}
          </div>
        )}
        {actionsList && (
          <div className="conversation-detail-section">
            <strong>Actions:</strong>
            {actionsList}
          </div>
        )}

        {conversationStatus === 'waiting_manual_think' && waitingManualThinkRequest && (
          <div className="conversation-detail-section">
            <strong>Manual Think Request:</strong>
            {waitingManualThinkRequest.prompt && (
              <div className="conversation-detail-manual-think-prompt">
                <strong>Prompt:</strong>
                <pre className="conversation-detail-manual-think-prompt-content">
                  {waitingManualThinkRequest.prompt}
                </pre>
              </div>
            )}
            {waitingManualThinkRequest.tools && waitingManualThinkRequest.tools.length > 0 && (
              <div className="conversation-detail-manual-think-tools">
                <strong>Tools:</strong>
                <ul>
                  {waitingManualThinkRequest.tools.map((tool, idx) => (
                    <li key={idx}>{tool}</li>
                  ))}
                </ul>
              </div>
            )}
            <form onSubmit={handleSubmitManualThink} className="conversation-detail-manual-think-form">
              <div className="conversation-detail-manual-think-field">
                <label>Method:</label>
                <input
                  type="text"
                  value={manualThinkMethod}
                  onChange={(e) => setManualThinkMethod(e.target.value)}
                  onFocus={() => { isEditingRef.current = true }}
                  onBlur={() => { setTimeout(() => { isEditingRef.current = false }, 500) }}
                  placeholder="输入 method 名称"
                  disabled={submittingManualThink}
                  required
                />
              </div>
              <div className="conversation-detail-manual-think-field">
                <label>Parameters (JSON):</label>
                <textarea
                  value={manualThinkParams}
                  onChange={(e) => setManualThinkParams(e.target.value)}
                  onFocus={() => { isEditingRef.current = true }}
                  onBlur={() => { setTimeout(() => { isEditingRef.current = false }, 500) }}
                  placeholder='{"key": "value"}'
                  rows={5}
                  disabled={submittingManualThink}
                />
              </div>
              <button
                type="submit"
                disabled={submittingManualThink || !manualThinkMethod.trim()}
                className="conversation-detail-manual-think-submit"
              >
                {submittingManualThink ? '提交中...' : '提交回复'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

