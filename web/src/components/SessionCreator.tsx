import { useState } from 'react'
import { sessionApi } from '../api/client'
import type { CreateSessionRequest } from '../types/api'

interface SessionCreatorProps {
  onSessionCreated: () => void
}

export default function SessionCreator({ onSessionCreated }: SessionCreatorProps) {
  const [userRequest, setUserRequest] = useState('')
  const [possess, setPossess] = useState(true)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userRequest.trim()) return

    setLoading(true)
    try {
      const request: CreateSessionRequest = {
        user_request: userRequest,
        possess,
      }
      await sessionApi.create(request)
      setUserRequest('')
      onSessionCreated()
    } catch (error) {
      console.error('Failed to create session:', error)
      alert('创建 Session 失败: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="session-creator">
      <form onSubmit={handleSubmit} className="session-creator-form">
        <textarea
          value={userRequest}
          onChange={(e) => setUserRequest(e.target.value)}
          placeholder="输入你的请求..."
          className="session-creator-input"
          rows={3}
          disabled={loading}
        />
        <div className="session-creator-options">
          <label className="session-creator-checkbox">
            <input
              type="checkbox"
              checked={possess}
              onChange={(e) => setPossess(e.target.checked)}
              disabled={loading}
            />
            <span>开启 LLM 附身</span>
          </label>
          <button
            type="submit"
            disabled={loading || !userRequest.trim()}
            className="session-creator-button"
          >
            {loading ? '创建中...' : '创建 Session'}
          </button>
        </div>
      </form>
    </div>
  )
}

