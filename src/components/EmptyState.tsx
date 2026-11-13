/** 빈 화면: 무엇이 없는지 한 줄 + 무엇을 하면 되는지 한 줄(+ 단추나 링크). */
export default function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
      {children && <div className="row">{children}</div>}
    </div>
  )
}
