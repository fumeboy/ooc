// 简单的轮询 Hook，用于每隔 interval 执行一次异步刷新。
import { useEffect } from 'react'

export function useAutoRefresh(fn: () => void, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    fn()
    const id = window.setInterval(fn, intervalMs)
    return () => clearInterval(id)
  }, [fn, intervalMs, enabled])
}

