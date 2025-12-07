// User Conversations 视图：轮询列表 + 发起 Talk。
import { useAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { conversationsBySessionAtom } from '../../atoms'
import { listConversations } from '../../api/client'
import ConversationSummary from './ConversationSummary'
import UserTalkForm from './UserTalkForm'
import WaitingManualConversationsTab from './WaitingManualConversationsTab'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import TabSwitcher from '../common/TabSwitcher'
import ConversationDetailTab from './ConversationDetailTab'
import { BsChatQuoteFill } from "react-icons/bs";

interface Props {
  sessionId: string
}

export default function ConversationsPage({ sessionId }: Props) {
  const [conversationsMap, setConversationsMap] = useAtom(conversationsBySessionAtom)
  const [loading, setLoading] = useState(false)
  const conversations = conversationsMap[sessionId] || []
  const [activeTab, setActiveTab] = useState('index')
  const [detailTabs, setDetailTabs] = useState<string[]>([])

  const refresh = useCallback(async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const res = await listConversations(sessionId)
      setConversationsMap((prev) => ({ ...prev, [sessionId]: res.conversations }))
    } finally {
      setLoading(false)
    }
  }, [sessionId, setConversationsMap])

  useAutoRefresh(refresh, 2000, Boolean(sessionId))

  const openDetail = (id: string) => {
    setDetailTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setActiveTab(id)
  }

  const closeDetail = (key: string) => {
    setDetailTabs((prev) => prev.filter((id) => id !== key))
    if (activeTab === key) setActiveTab('index')
  }

  const tabs = useMemo(() => {
    const base = [
      { key: 'index', label: 'Conversations' },
      { key: 'waiting', label: '等待手动' },
    ]
    const details = detailTabs.map((id) => ({
      key: id,
      label: `对话 ${id.slice(-4)}`,
      closable: true,
    }))
    return [...base, ...details]
  }, [detailTabs])

  return (
    <div className="relative flex flex-1 flex-col gap-2 h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BsChatQuoteFill className="text-blue-600" size={20}/>
          <h4 className="font-semibold">Conversations</h4>
        </div>
        <TabSwitcher tabs={tabs} activeKey={activeTab} onChange={setActiveTab} onClose={closeDetail} />
      </div>

      {activeTab === 'index' && (
        <>
          {sessionId ? (
            <UserTalkForm sessionId={sessionId} onSent={refresh} />
          ) : (
            <div className="card" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '24px' }}>
              请先选择 Session
            </div>
          )}
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">列表</h4>
            {loading && <span className="text-xs text-slate-500">刷新中...</span>}
          </div>
          <div
            className="scroll-area"
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '16px',
              }}
            >
              {conversations.map((conv) => (
                <ConversationSummary
                  key={conv.id}
                  sessionId={sessionId}
                  conversation={conv}
                  onViewDetail={openDetail}
                  layout="vertical"
                />
              ))}
            </div>
            {conversations.length === 0 && <div className="text-sm text-slate-500 card mt-2">暂无 Conversation</div>}
          </div>
        </>
      )}
      {activeTab === 'waiting' && (
        <WaitingManualConversationsTab sessionId={sessionId} onViewDetail={openDetail} />
      )}
      {activeTab !== 'index' && activeTab !== 'waiting' && (
        <ConversationDetailTab sessionId={sessionId} conversationId={activeTab} onClose={() => closeDetail(activeTab)} />
      )}
    </div>
  )
}

