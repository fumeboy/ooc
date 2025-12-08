// 左侧面板：承载 Tab 以及 Conversation/Info 视图。
import { useAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { selectedSessionIdAtom } from '../atoms'
import TabSwitcher from './common/TabSwitcher'
import ConversationsPage from './conversation/ConversationsPage'
import InfosPage from './info/InfosPage'
import UserTalkForm from './conversation/UserTalkForm'
import { LuPanelRight } from 'react-icons/lu'
import { FaConnectdevelop } from "react-icons/fa";
import { buildTabSearchParams, parseTabState, type TabKey } from '../routing/tabState'

interface Props {
  onToggleSessionList: () => void
}

export default function Main({ onToggleSessionList }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedSessionId] = useAtom(selectedSessionIdAtom)
  
  const parsed = useMemo(() => parseTabState(searchParams), [searchParams])
  const activeKey = parsed.tab
  
  const [showTalk, setShowTalk] = useState(true)
  const refreshRef = useRef<() => void>(() => {})
  const openConvRef = useRef<(id: string) => void>(() => {})
  const [pendingOpenConvId, setPendingOpenConvId] = useState<string | null>(null)
  const initialApplied = useRef(false)

  const syncSearchParams = (next: Partial<{ tab: TabKey; convTab: string; infoTab: string }>) => {
    const base = new URLSearchParams(searchParams)
    // 当主动切换到 Info 主 Tab 时，重置 convTab 以允许进入 Info 页
    if (next.tab === 'info') {
      base.set('convTab', 'index')
    }
    const newParams = buildTabSearchParams(base, next)
    setSearchParams(newParams, { replace: true })
  }

  const tabs = useMemo(() => {
    return [
      { key: 'conversation', label: 'Conversations' },
      { key: 'info', label: 'Infos' },
    ]
  }, [])

  const renderContent = () => {
    if (activeKey === 'conversation')
      return (
        <ConversationsPage
          sessionId={selectedSessionId || ''}
          initialActiveTab={parsed.convTab}
          onRegisterRefresh={(fn) => {
            refreshRef.current = fn
          }}
          onRegisterOpenDetail={(fn) => {
            openConvRef.current = fn
          }}
          openConversationId={pendingOpenConvId}
          onConsumeOpenConversation={() => setPendingOpenConvId(null)}
          onActiveTabChange={(key) => syncSearchParams({ convTab: key, tab: 'conversation' })}
        />
      )
    if (activeKey === 'info')
      return (
        <InfosPage
          sessionId={selectedSessionId || ''}
          initialActiveTab={parsed.infoTab}
          onActiveTabChange={(key) => syncSearchParams({ infoTab: key })}
          onOpenConversation={(id) => {
            syncSearchParams({ convTab: id, tab: 'conversation', infoTab: 'index' })
            setPendingOpenConvId(id)
            openConvRef.current?.(id)
          }}
        />
      )
    return null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK =
        e.code === 'KeyK' ||
        e.key.toLowerCase() === 'k'
      if (e.altKey && isK) {
        e.preventDefault()
        setShowTalk((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setShowTalk])

  // 首次应用 URL 初始化后的待打开会话
  useEffect(() => {
    if (initialApplied.current) return
    initialApplied.current = true
    if (activeKey === 'conversation' && parsed.convTab && parsed.convTab !== 'index' && parsed.convTab !== 'waiting') {
      setPendingOpenConvId(parsed.convTab)
    }
  }, [activeKey, parsed.convTab])

  // 页面/Tab 切换时更新 URL（仅在选中 Session 场景）
  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <Header
        tabs={tabs}
        activeKey={activeKey}
        onTabChange={(key) => syncSearchParams({ tab: key as TabKey })}
        onToggleSessionList={onToggleSessionList}
      />
      <div className="flex-1" style={{
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}>{renderContent()}</div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: showTalk ? 'translate(-50%, 0)' : 'translate(-50%, 120%)',
          bottom: '12px',
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          transition: 'transform 160ms ease, opacity 160ms ease',
          opacity: showTalk ? 1 : 0,
          pointerEvents: showTalk ? 'auto' : 'none',
        }}
      >
        {selectedSessionId ? (
          <UserTalkForm
            floating={false}
            sessionId={selectedSessionId}
            onSent={() => refreshRef.current?.()}
          />
        ) : (
          <div className="card text-sm">请选择 Session 以发起 Talk</div>
        )}
      </div>
      {!showTalk && (
        <button
          onClick={() => setShowTalk(true)}
          className="btn-secondary text-xs"
          style={{
            position: 'absolute',
            left: '16px',
            bottom: '16px',
            borderRadius: '999px',
            padding: '6px 12px',
            background: '#bdbdbd17',
            border: '1px solid var(--border-color)',
          }}
        >
          展开 Talk（Alt + K）
        </button>
      )}
    </div>
  )
}

interface HeaderProps {
  tabs: { key: string; label: string }[]
  activeKey: string
  onTabChange: (key: string) => void
  onToggleSessionList: () => void
}

function Header({ tabs, activeKey, onTabChange, onToggleSessionList }: HeaderProps) {
  return (
    <div className="flex items-center justify-between mb-2 px-8">
      <h1 className="flex items-center gap-2 font-serif text-gray-500 bg-white-800 px-4 rounded-lg border border-gray-300"><FaConnectdevelop className="text-green-600" size={20}/> {"OOContext"}</h1>
      <TabSwitcher tabs={tabs} activeKey={activeKey} onChange={onTabChange} />
      <button
        className="btn-secondary"
        style={{ padding: '6px 8px', borderRadius: '10px' }}
        onClick={onToggleSessionList}
        aria-label="Session 列表"
      >
        <LuPanelRight size={16} />
      </button>
    </div>
  )
}

