import { LuLoader } from 'react-icons/lu'

interface Props {
  loading: boolean
  text?: string
}

export default function LoadingSpinner({ loading, text }: Props) {
  return (
    <div
      className={`flex items-center gap-1 text-xs text-slate-500 transition-opacity duration-300 ${
        loading ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ pointerEvents: 'none' }}
    >
      <LuLoader className="animate-spin" size={14} />
      {text && <span>{text}</span>}
    </div>
  )
}

