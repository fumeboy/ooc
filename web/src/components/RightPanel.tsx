import { useState, useEffect } from 'react'
import { sessionApi } from '../api/client'
import type { SessionListItem } from '../types/api'
import SessionCreator from './SessionCreator'
import SessionList from './SessionList'

interface RightPanelProps {
  selectedSessionId: string | null
  onSessionSelect: (id: string | null) => void
}

export default function RightPanel({ selectedSessionId, onSessionSelect }: RightPanelProps) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(false)

  const refreshSessions = async () => {
    setLoading(true)
    try {
      const response = await sessionApi.list()
      setSessions(response.sessions)
    } catch (error) {
      console.error('Failed to fetch sessions:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refreshSessions()
  }, [])

  const handleSessionCreated = () => {
    refreshSessions()
  }

  return (
    <div className="right-panel">
      <div className="right-panel-header">
        <SessionCreator onSessionCreated={handleSessionCreated} />
      </div>
      <div className="right-panel-body">
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelect={onSessionSelect}
          loading={loading}
          onRefresh={refreshSessions}
        />
      </div>
    </div>
  )
}

