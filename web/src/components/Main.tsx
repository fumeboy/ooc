// 左侧面板：承载 Tab 以及 Conversation/Info 视图。
import { useAtom } from 'jotai'
import { useMemo, useState } from 'react'
import { selectedSessionIdAtom } from '../atoms'
import TabSwitcher from './common/TabSwitcher'
import ConversationsPage from './conversation/ConversationsPage'
import InfosPage from './info/InfosPage'
import { LuPanelRight } from 'react-icons/lu'
import { FaConnectdevelop } from "react-icons/fa";

interface Props {
  onToggleSessionList: () => void
}

export default function Main({ onToggleSessionList }: Props) {
  const [selectedSessionId] = useAtom(selectedSessionIdAtom)
  const [activeKey, setActiveKey] = useState('user')

  const tabs = useMemo(() => {
    return [
      { key: 'user', label: 'User Conversations' },
      { key: 'info', label: 'Info 表格' },
    ]
  }, [])

  const renderContent = () => {
    if (activeKey === 'user') return <ConversationsPage sessionId={selectedSessionId || ''} />
    if (activeKey === 'info') return <InfosPage sessionId={selectedSessionId || ''} />
    return null
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Header
        tabs={tabs}
        activeKey={activeKey}
        onTabChange={setActiveKey}
        onToggleSessionList={onToggleSessionList}
      />
      <div className="flex-1 scroll-area p-4" style={{
        background: "var(--bg-deep)",
        height: '100%',
        width: '100%',
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow)",
        border: "1px solid var(--border-color)",
        overflow: 'hidden',
      }}>{renderContent()}</div>
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
    <div className="flex items-center justify-between mb-2">
      <h1 className="flex items-center gap-2 text-gray-500 bg-white px-4 rounded-lg border border-gray-300"><FaConnectdevelop className="text-blue-600" size={20}/> OOC</h1>
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

