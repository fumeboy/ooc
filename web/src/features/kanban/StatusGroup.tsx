// kernel/web/src/features/kanban/StatusGroup.tsx

interface StatusGroupProps {
  label: string;
  color: string;
  count: number;
  children: React.ReactNode;
}

export function StatusGroup({ label, color, count, children }: StatusGroupProps) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
