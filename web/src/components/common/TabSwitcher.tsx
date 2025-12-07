// Tab 切换组件，支持可关闭的动态标签。
interface TabItem {
  key: string
  label: string
  closable?: boolean
}

interface Props {
  tabs: TabItem[]
  activeKey: string
  onChange: (key: string) => void
  onClose?: (key: string) => void
}

export default function TabSwitcher({ tabs, activeKey, onChange, onClose }: Props) {
  return (
    <div className="flex gap-2">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey
        return (
          <button
            key={tab.key}
            className={`tab ${isActive ? 'tab-active' : ''}`}
            onClick={() => onChange(tab.key)}
          >
            <span>{tab.label}</span>
            {tab.closable && (
              <span
                className="ml-2 text-xs font-bold text-black cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose?.(tab.key)
                }}
              >
                ✕
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

