import { useAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { listSessions } from '../../api/client'
import { selectedSessionIdAtom, sessionsAtom, sessionsLoadingAtom } from '../../atoms'
import type { ThemeMode } from '../../styles/theme'
import SessionCreator from './SessionCreator'
import SessionList from './SessionList'

interface Props {
  visible: boolean
  onClose: () => void
  onThemeToggle: () => void
  currentTheme: ThemeMode
}

export default function SessionListPanel({ visible, onClose, onThemeToggle, currentTheme }: Props) {
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [loading, setLoading] = useAtom(sessionsLoadingAtom)
  const [selectedSessionId, setSelectedSessionId] = useAtom(selectedSessionIdAtom)

  const refreshSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listSessions()
      setSessions(res.sessions)
      if (!selectedSessionId && res.sessions.length > 0) {
        setSelectedSessionId(res.sessions[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedSessionId, setSelectedSessionId, setSessions, setLoading])

  useEffect(() => {
    if (visible) {
      refreshSessions()
    }
  }, [visible, refreshSessions])

  return (
    <div
      aria-hidden={!visible}
      style={{
        position: 'absolute',
        top: '80px',
        right: '16px',
        width: '320px',
        maxWidth: '80vw',
        height: 'calc(100% - 180px)',
        transform: visible ? 'translateX(0)' : 'translateX(110%)',
        transition: 'transform 180ms ease',
        background: 'rgba(253, 253, 253, 0.9)',
        borderRadius: '10px',
        padding: '12px',
        border: '1px solid var(--border-color)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm">主题：{currentTheme}</span>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs" onClick={onThemeToggle}>
            切换主题
          </button>
          <button className="btn-secondary text-xs" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <SessionCreator
        onCreated={(id) => setSelectedSessionId(id)}
        onRefreshingSessions={refreshSessions}
      />
      <div className="flex-1 overflow-auto mt-2">
        <SessionList
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          onSelect={setSelectedSessionId}
          loading={loading}
          onRefresh={refreshSessions}
        />
      </div>
    </div>
  )
}

