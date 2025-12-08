// 创建 Session 的表单组件。
import { FormEvent, useState } from 'react'
import { createSession } from '../../api/client'

interface Props {
  onCreated?: (sessionId: string) => void
  onRefreshingSessions?: () => void
  variant?: 'panel' | 'hero'
}

export default function SessionCreator({ onCreated, onRefreshingSessions, variant = 'panel' }: Props) {
  const [userRequest, setUserRequest] = useState('')
  const [possess, setPossess] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isHero = variant === 'hero'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!userRequest.trim()) {
      setError('请输入用户请求')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await createSession({ user_request: userRequest, possess })
      onRefreshingSessions?.()
      onCreated?.(res.session_id)
      setUserRequest('')
    } catch (err) {
      setError((err as Error).message || '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      className={isHero ? 'glass mb-4' : 'card mb-3'}
      onSubmit={handleSubmit}
      style={
        isHero
          ? {
              padding: '16px',
              borderRadius: '14px',
              border: '1px solid var(--border-color)',
              boxShadow: '0 16px 50px rgba(0,0,0,0.06)',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(245,247,255,0.9))',
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">创建 Session</h3>
        <label className="text-sm flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={possess} onChange={(e) => setPossess(e.target.checked)} />
          附身
        </label>
      </div>
      <textarea
        className="input"
        rows={3}
        placeholder="用户请求..."
        value={userRequest}
        onChange={(e) => setUserRequest(e.target.value)}
        style={
          isHero
            ? {
                background: 'rgba(255,255,255,0.7)',
                borderRadius: '12px',
              }
            : undefined
        }
      />
      {error && <div className="text-red-500 text-sm mt-1">{error}</div>}
      <button
        className="btn-primary mt-2 w-full"
        type="submit"
        disabled={submitting}
        style={isHero ? { padding: '10px 14px', borderRadius: '12px', fontWeight: 600 } : undefined}
      >
        {submitting ? '创建中...' : '创建 Session'}
      </button>
    </form>
  )
}

