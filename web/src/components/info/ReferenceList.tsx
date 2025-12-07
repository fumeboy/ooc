// 引用列表展示组件。
interface Props {
  references?: Record<string, string>
  onViewConversation?: (id: string) => void
}

export default function ReferenceList({ references, onViewConversation }: Props) {
  if (!references || Object.keys(references).length === 0) return <div className="text-xs text-slate-500">无引用</div>

  return (
    <ul className="text-xs text-slate-700 space-y-1">
      {Object.entries(references).map(([id, reason]) => (
        <li key={id} className="flex items-center justify-between gap-2">
          <span className="truncate">
            {id} {reason ? `(${reason})` : ''}
          </span>
          {onViewConversation && id.startsWith('conversation::') && (
            <button className="btn-secondary text-[11px]" onClick={() => onViewConversation(id.replace('conversation::', ''))}>
              查看对话
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

