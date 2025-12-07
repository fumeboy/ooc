// 针对核心原子状态的行为测试，确保持久化逻辑符合预期。
import { describe, expect, it } from 'vitest'
import { createStore } from 'jotai/vanilla'
import { layoutAtom } from '../atoms'

describe('atoms/layoutAtom', () => {
  it('写入时会持久化到 localStorage', () => {
    const store = createStore()
    store.set(layoutAtom, { left: 60, right: 40 })

    expect(store.get(layoutAtom).left).toBe(60)
    expect(window.localStorage.getItem('layout')).toContain('60')
  })
})

