export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

