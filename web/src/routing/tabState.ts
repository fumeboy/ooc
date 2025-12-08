// 路由状态工具：集中解析与生成 tab/convTab/infoTab，保持 URL 为唯一事实来源。
export type TabKey = 'conversation' | 'info'
export interface TabState {
  tab: TabKey
  convTab: string
  infoTab: string
}

const DEFAULT_TAB: TabKey = 'conversation'
const DEFAULT_CONV_TAB = 'index'
const DEFAULT_INFO_TAB = 'index'

export function parseTabState(searchParams: URLSearchParams): TabState {
  const tabParam = searchParams.get('tab') as TabKey | null
  const convTab = searchParams.get('convTab') || DEFAULT_CONV_TAB
  const infoTab = searchParams.get('infoTab') || DEFAULT_INFO_TAB

  const convIsDetail = convTab !== 'index' && convTab !== 'waiting'
  const infoIsDetail = infoTab !== 'index'

  let tab: TabKey = DEFAULT_TAB
  if (convIsDetail) {
    tab = 'conversation'
  } else if (infoIsDetail) {
    tab = 'info'
  } else if (tabParam === 'info') {
    tab = 'info'
  }

  return { tab, convTab, infoTab }
}

export function buildTabSearchParams(base: URLSearchParams, next: Partial<TabState>): URLSearchParams {
  const params = new URLSearchParams(base)
  const convTab = next.convTab ?? params.get('convTab') ?? DEFAULT_CONV_TAB
  const infoTab = next.infoTab ?? params.get('infoTab') ?? DEFAULT_INFO_TAB

  let tab: TabKey = next.tab ?? (params.get('tab') as TabKey | null) ?? DEFAULT_TAB

  const convIsDetail = convTab !== 'index' && convTab !== 'waiting'
  const infoIsDetail = infoTab !== 'index'

  if (convIsDetail) {
    tab = 'conversation'
  } else if (infoIsDetail) {
    tab = 'info'
  }

  params.set('tab', tab)
  params.set('convTab', convTab)
  params.set('infoTab', infoTab)
  return params
}

