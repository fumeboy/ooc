// App 组件：提供整体布局、主题切换与左右分栏拖拽。
import { useAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import Main from './Main'
import SessionListPanel from './session/SessionListPanel'
import { layoutAtom } from '../atoms'
import type { ThemeMode } from '../styles/theme'
import { applyTheme, toggleTheme } from '../styles/theme'

interface Props {
  initialTheme: ThemeMode
}

export default function App({ initialTheme }: Props) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme)
  const [layout, setLayout] = useAtom(layoutAtom)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [showSessionList, setShowSessionList] = useState(false)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const columns = useMemo(() => `100%`, [])

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
          <Main onToggleSessionList={() => setShowSessionList((v) => !v)} />
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

