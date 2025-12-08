// Homepage：未选择 Session 时的入口，居中展示 Session 创建与列表（类 ChatGPT 风格）。
import { useAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { listSessions } from '../api/client'
import { selectedSessionIdAtom, sessionsAtom, sessionsLoadingAtom } from '../atoms'
import SessionCreator from './session/SessionCreator'
import SessionList from './session/SessionList'

export default function Homepage() {
  const [sessions, setSessions] = useAtom(sessionsAtom)
  const [loading, setLoading] = useAtom(sessionsLoadingAtom)
  const [, setSelectedSessionId] = useAtom(selectedSessionIdAtom)

  const refreshSessions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listSessions()
      setSessions(res.sessions)
    } finally {
      setLoading(false)
    }
  }, [setLoading, setSessions])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  return (
    <div className="h-full w-full flex items-center justify-center">
      <div
        className="glass"
        style={{
          width: 'min(1000px, 94vw)',
          padding: '24px',
          borderRadius: '18px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 20px 70px rgba(0,0,0,0.08)',
          background: 'linear-gradient(145deg, rgba(255,255,255,0.95), rgba(245,248,255,0.92))',
        }}
      >
        <div className="text-center mb-4">
          <div className="text-3xl font-semibold text-slate-800">欢迎使用 OOC Agent</div>
          <div className="text-sm text-slate-500 mt-1">请选择或创建 Session 后开始对话</div>
        </div>
        <SessionCreator
          variant="hero"
          onCreated={(id) => {
            setSelectedSessionId(id)
            refreshSessions()
          }}
          onRefreshingSessions={refreshSessions}
        />
        <SessionList
          variant="hero"
          sessions={sessions}
          selectedSessionId={null}
          onSelect={(id) => setSelectedSessionId(id)}
          loading={loading}
          onRefresh={refreshSessions}
        />
        <div className="text-xs text-slate-500 mt-3 text-center">
          快捷键：Alt + T 呼出/隐藏 Talk 面板（选择 Session 后生效）
        </div>
      </div>
    </div>
  )
}


