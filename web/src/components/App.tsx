// App 组件：提供整体布局、主题切换与左右分栏拖拽。
import { useAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Main from './Main'
import SessionListPanel from './session/SessionListPanel'
import Homepage from './Homepage'
import { selectedSessionIdAtom } from '../atoms'
import type { ThemeMode } from '../styles/theme'
import { applyTheme, toggleTheme } from '../styles/theme'

interface Props {
  initialTheme: ThemeMode
}

export default function App({ initialTheme }: Props) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme)
  const [selectedSessionId, setSelectedSessionId] = useAtom(selectedSessionIdAtom)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [showSessionList, setShowSessionList] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { id: sessionIdFromPath } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const sessionIdFromQuery = searchParams.get('sessionId')

  const initialSessionId = useMemo(() => {
    if (sessionIdFromPath) return sessionIdFromPath
    if (sessionIdFromQuery) return sessionIdFromQuery
    const fromStorage = window.localStorage.getItem('lastSessionId')
    return fromStorage || null
  }, [sessionIdFromPath, sessionIdFromQuery])

  const hasTabQuery = useMemo(() => {
    return searchParams.has('tab') || searchParams.has('convTab') || searchParams.has('infoTab')
  }, [searchParams])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useLayoutEffect(() => {
    if (!selectedSessionId && initialSessionId) {
      setSelectedSessionId(initialSessionId)
    }
  }, [selectedSessionId, initialSessionId, setSelectedSessionId])

  useEffect(() => {
    if (selectedSessionId) {
      window.localStorage.setItem('lastSessionId', selectedSessionId)
    }
  }, [selectedSessionId])

  useEffect(() => {
    if (!selectedSessionId) return
    const currentId = sessionIdFromPath || sessionIdFromQuery
    if (currentId === selectedSessionId) return
    const params = new URLSearchParams(location.search)
    params.delete('sessionId')
    const search = params.toString()
    navigate(
      {
        pathname: `/session/${encodeURIComponent(selectedSessionId)}`,
        search: search ? `?${search}` : '',
      },
      { replace: true }
    )
  }, [selectedSessionId, sessionIdFromPath, sessionIdFromQuery, navigate, location.search])

  return (
    <div className="min-h-screen w-full relative overflow-hidden" style={{ background: 'transparent' }}>
      <div
        className="absolute inset-0 pointer-events-none color-bg"
        aria-hidden
        style={{
          zIndex: "-1",
          opacity: "0.1"
        }}
      />

      <div
        className="relative"
        ref={containerRef}
        style={{
          width: '96vw',
          height: '96vh',
          maxWidth: '96vw',
          maxHeight: '96vh',
          overflow: 'hidden',
          position: 'absolute',
          top: '2vh',
          left: '2vw',
          background: "var(--bg-secondary)",
          padding: "12px",
          backdropFilter: "blur(14px)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border-color)",
        }}
      >
        <div className='z-1' style={{
          height: '100%',
          width: '100%',
        }}>
          {(selectedSessionId || initialSessionId || hasTabQuery) ? (
            <Main onToggleSessionList={() => setShowSessionList((v) => !v)} />
          ) : (
            <Homepage />
          )}
          <SessionListPanel
            visible={showSessionList}
            onClose={() => setShowSessionList(false)}
            onThemeToggle={() => setTheme((t) => toggleTheme(t))}
            currentTheme={theme}
          />
        </div>
      </div>
    </div>
  )
}

