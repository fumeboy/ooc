// 路由状态单元测试：确保 tab/convTab/infoTab 的解析与生成符合约定。
import { describe, expect, it } from 'vitest'
import { buildTabSearchParams, parseTabState } from '../routing/tabState'

describe('tab routing state', () => {
  it('falls back to defaults when no params given', () => {
    const params = new URLSearchParams()
    expect(parseTabState(params)).toEqual({ tab: 'user', convTab: 'index', infoTab: 'index' })
  })

  it('forces user tab when convTab is detail', () => {
    const params = new URLSearchParams({ tab: 'info', convTab: '123', infoTab: 'index' })
    expect(parseTabState(params)).toEqual({ tab: 'user', convTab: '123', infoTab: 'index' })
  })

  it('forces info tab when infoTab is detail and conv is not detail', () => {
    const params = new URLSearchParams({ tab: 'user', infoTab: 'abc' })
    expect(parseTabState(params)).toEqual({ tab: 'info', convTab: 'index', infoTab: 'abc' })
  })

  it('keeps manual tab when convTab is waiting and infoTab is index', () => {
    const params = new URLSearchParams({ tab: 'info', convTab: 'waiting' })
    expect(parseTabState(params)).toEqual({ tab: 'info', convTab: 'waiting', infoTab: 'index' })
  })

  it('builds search params and enforces detail priority', () => {
    const base = new URLSearchParams({ tab: 'info', infoTab: 'index' })
    const withInfoDetail = buildTabSearchParams(base, { infoTab: 'abc' })
    expect(parseTabState(withInfoDetail)).toEqual({ tab: 'info', convTab: 'index', infoTab: 'abc' })

    const withConvDetail = buildTabSearchParams(base, { convTab: '42' })
    expect(parseTabState(withConvDetail)).toEqual({ tab: 'user', convTab: '42', infoTab: 'index' })
  })
})

