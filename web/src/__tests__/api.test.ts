// API 适配层的 TDD：锁定请求路径、方法、负载与错误处理。
import {
  createSession,
  listSessions,
  setPossess,
  getWaitingManualConversations,
} from '../api/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const okResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

describe('api/client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createSession 发送正确 body 与路径', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ session_id: 's1', status: 'running' }))

    const res = await createSession({ user_request: 'hello', possess: true })

    expect(res.session_id).toBe('s1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ user_request: 'hello', possess: true }),
      })
    )
  })

  it('listSessions 返回 sessions 列表', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ sessions: [{ id: 's1', status: 'running', created_at: 't', updated_at: 't', possessed: false }] })
    )

    const data = await listSessions()

    expect(data.sessions).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.any(Object))
  })

  it('setPossess POST /possess', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ possessed: true }))

    const res = await setPossess('s1', true)

    expect(res.possessed).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s1/possess',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('getWaitingManualConversations 命中正确路径', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ conversations: [] }))

    const res = await getWaitingManualConversations('s1')

    expect(res.conversations).toEqual([])
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/waiting_manual_conversations', expect.any(Object))
  })

  it('错误状态抛出 ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('boom', {
        status: 500,
        statusText: 'server error',
      })
    )

    await expect(listSessions()).rejects.toMatchObject({ status: 500 })
  })
})

