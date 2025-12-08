// User Conversations 视图：轮询列表 + 发起 Talk。
import { useAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { conversationsBySessionAtom, conversationActiveTabBySessionAtom, conversationDetailTabsBySessionAtom } from '../../atoms'
import { listConversations } from '../../api/client'
import ConversationSummary from './ConversationSummary'
import WaitingManualConversationsTab from './WaitingManualConversationsTab'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import TabSwitcher from '../common/TabSwitcher'
import ConversationDetailTab from './ConversationDetailTab'
import { BsChatQuoteFill } from "react-icons/bs";
import LoadingSpinner from '../common/LoadingSpinner'
import PageLayout from '../common/PageLayout'

interface Props {
  sessionId: string
  onRegisterRefresh?: (fn: () => void) => void
  onRegisterOpenDetail?: (fn: (id: string) => void) => void
  openConversationId?: string | null
  onConsumeOpenConversation?: () => void
  initialActiveTab?: string
  onActiveTabChange?: (tab: string) => void
}

export default function ConversationsPage({
  sessionId,
  onRegisterRefresh,
  onRegisterOpenDetail,
  openConversationId,
  onConsumeOpenConversation,
  initialActiveTab = 'index',
  onActiveTabChange,
}: Props) {
  const [conversationsMap, setConversationsMap] = useAtom(conversationsBySessionAtom)
  const [activeTabMap, setActiveTabMap] = useAtom(conversationActiveTabBySessionAtom)
  const [detailTabsMap, setDetailTabsMap] = useAtom(conversationDetailTabsBySessionAtom)
  
  const [loading, setLoading] = useState(false)
  
  const conversations = conversationsMap[sessionId] || []
  const activeTab = activeTabMap[sessionId] || 'index'
  const detailTabs = detailTabsMap[sessionId] || []

  const setActive = useCallback(
    (key: string) => {
      setActiveTabMap((prev) => ({ ...prev, [sessionId]: key }))
      onActiveTabChange?.(key)
    },
    [sessionId, setActiveTabMap, onActiveTabChange]
  )
  
  // const setDetailTabs = useCallback(
  //   (tabs: string[]) => {
  //     setDetailTabsMap((prev) => ({ ...prev, [sessionId]: tabs }))
  //   },
  //   [sessionId, setDetailTabsMap]
  // )

  const setDetailTabsUpdater = useCallback(
    (updater: (prev: string[]) => string[]) => {
      setDetailTabsMap((prev) => {
        const current = prev[sessionId] || []
        const next = updater(current)
        return { ...prev, [sessionId]: next }
      })
    },
    [sessionId, setDetailTabsMap]
  )

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

  useEffect(() => {
    onRegisterRefresh?.(refresh)
    return () => {
      onRegisterRefresh?.(() => {})
    }
  }, [refresh, onRegisterRefresh])

  useEffect(() => {
    onRegisterOpenDetail?.(openDetail)
    return () => {
      onRegisterOpenDetail?.(() => {})
    }
  }, [onRegisterOpenDetail])

  useEffect(() => {
    if (!sessionId || !initialActiveTab) return
    // Only update if current active tab is different from initialActiveTab
    // This breaks the loop because setActive updates the Atom which triggers re-render, 
    // but on next render activeTab will match initialActiveTab (if sync is fast enough) 
    // or we just check against the prop to avoid redundant updates.
    
    // Actually, the issue is likely that initialActiveTab comes from parent (URL state)
    // and setActive updates Atom state. If Atom update triggers parent re-render or 
    // if parent passes new reference, this effect runs again.
    
    // We should only sync FROM props TO atom if they mismatch significantly.
    
    if (activeTab === initialActiveTab) return
    
    // Also check if initialActiveTab is valid (e.g. part of details or index/waiting)
    
    if (initialActiveTab === 'index' || initialActiveTab === 'waiting') {
      setActive(initialActiveTab)
      return
    }
    
    setActive(initialActiveTab)
    setDetailTabsUpdater((prev) => (prev.includes(initialActiveTab) ? prev : [...prev, initialActiveTab]))
  }, [initialActiveTab, sessionId, setActive, setDetailTabsUpdater, activeTab])

  useEffect(() => {
    if (openConversationId) {
      openDetail(openConversationId)
      onConsumeOpenConversation?.()
    }
  }, [openConversationId, onConsumeOpenConversation])

  // Removed localStorage logic as jotai persistence or atoms should handle state
  // If we really need localStorage persistence for tabs, we should implement it in atoms or a separate effect
  // For now, let's rely on atoms in memory and URL as source of truth for current active tab

  const openDetail = useCallback((id: string) => {
    setDetailTabsUpdater((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setActive(id)
  }, [setActive, setDetailTabsUpdater])

  const closeDetail = useCallback((key: string) => {
    setDetailTabsUpdater((prev) => prev.filter((id) => id !== key))
    
    // Check current active tab from the atom map directly in the updater if possible, 
    // but here we are in a callback. We can check the prop `activeTab` which is from atom.
    if (activeTab === key) {
        setActive('index')
    }
  }, [activeTab, setActive, setDetailTabsUpdater])

  const tabs = useMemo(() => {
    const base = [
      { key: 'index', label: 'TalkWithYou' },
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
    <PageLayout
      header={
        <>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-4 rounded-lg border border-gray-300">
              <BsChatQuoteFill className="text-blue-600" size={18} />
              <h4 className="font-semibold">Conversations</h4>
            </div>
            <LoadingSpinner loading={loading} text="刷新中..." />
          </div>
          <TabSwitcher tabs={tabs} activeKey={activeTab} onChange={setActive} onClose={closeDetail} />
        </>
      }
    >
      {activeTab === 'index' && (
        <div
          className="scroll-area"
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
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
      )}
      {activeTab === 'waiting' && (
        <WaitingManualConversationsTab sessionId={sessionId} onViewDetail={openDetail} />
      )}
      {activeTab !== 'index' && activeTab !== 'waiting' && (
        <ConversationDetailTab
          sessionId={sessionId}
          conversationId={activeTab}
          onClose={() => closeDetail(activeTab)}
          onOpenConversation={openDetail}
        />
      )}
    </PageLayout>
  )
}

