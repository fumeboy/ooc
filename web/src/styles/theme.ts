// 主题管理：切换明暗主题并持久化到 localStorage。
const THEME_KEY = 'theme'

export type ThemeMode = 'light' | 'dark'

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  const cached = window.localStorage.getItem(THEME_KEY) as ThemeMode | null
  if (cached === 'light' || cached === 'dark') return cached
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  window.localStorage.setItem(THEME_KEY, theme)
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  const next: ThemeMode = current === 'light' ? 'dark' : 'light'
  applyTheme(next)
  return next
}

