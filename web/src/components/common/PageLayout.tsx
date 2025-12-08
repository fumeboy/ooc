import React from 'react'

interface Props {
  header: React.ReactNode
  children: React.ReactNode
}

export default function PageLayout({ header, children }: Props) {
  return (
    <div className="relative flex flex-1 flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2" style={{
        background: "#fff",
        borderRadius: "var(--radius) var(--radius) 0 0",
        borderTop: "1px solid var(--border-color)",
        borderLeft: "1px solid var(--border-color)",
        borderRight: "1px solid var(--border-color)",
      }}>
        {header}
      </div>

      <div className="flex-1 px-2 py-4" style={{
        background: "#fff",
        borderRadius: "0 0 var(--radius) var(--radius)",
        boxShadow: "var(--shadow)",
        border: "1px solid var(--border-color)",
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {children}
      </div>
    </div>
  )
}

