// Jotai 状态集中定义，避免组件间重复逻辑。
import { atom } from 'jotai'
import type {
  ConversationResponse,
  InfoListItem,
  SessionListItem,
} from '../types/api'

export const sessionsAtom = atom<SessionListItem[]>([])
export const sessionsLoadingAtom = atom(false)

export const selectedSessionIdAtom = atom<string | null>(null)

export const conversationsBySessionAtom = atom<Record<string, ConversationResponse[]>>({})
export const conversationDetailsAtom = atom<Record<string, ConversationResponse | undefined>>({})

export const infosBySessionAtom = atom<Record<string, InfoListItem[]>>({})
export const selectedInfoBySessionAtom = atom<Record<string, string | null>>({})

export const waitingManualConversationsAtom = atom<Record<string, ConversationResponse[]>>({})

export const manualThinkMethodByConversationAtom = atom<Record<string, string>>({})
export const manualThinkParamsByConversationAtom = atom<Record<string, string>>({})
export const submittingManualThinkByConversationAtom = atom<Record<string, boolean>>({})

export const openConversationTabsAtom = atom<string[]>([])

export const conversationActiveTabBySessionAtom = atom<Record<string, string>>({})
export const conversationDetailTabsBySessionAtom = atom<Record<string, string[]>>({})

export const infoActiveTabBySessionAtom = atom<Record<string, string>>({})
export const infoDetailTabsBySessionAtom = atom<Record<string, string[]>>({})

const defaultLayout = { left: 68, right: 32 }

function loadLayout() {
  if (typeof window === 'undefined') return defaultLayout
  try {
    const raw = window.localStorage.getItem('layout')
    if (raw) return JSON.parse(raw) as typeof defaultLayout
  } catch {
    // ignore parse errors
  }
  return defaultLayout
}

const layoutInnerAtom = atom(loadLayout())

export const layoutAtom = atom(
  (get) => get(layoutInnerAtom),
  (get, set, next: { left: number; right: number }) => {
    const value = next
    set(layoutInnerAtom, value)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('layout', JSON.stringify(value))
    }
  }
)

