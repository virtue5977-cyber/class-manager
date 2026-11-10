import { useDb } from '../../app/context'
import type { NoticeItemRec } from '../../lib/db/types'
import { noticesOn } from '../../lib/notices/notices'
import { useLive } from '../../lib/ui/useLive'

/** 그날 전달사항(설계서 3 §2). */
export default function NoticeTab({ date }: { date: string }) {
  const db = useDb()
  const list = useLive<NoticeItemRec[]>(() => noticesOn(db, date), [db, date], [])
  return (
    <section className="notice-tab" aria-label="전달사항">
      <ul className="plain">
        {list.map((n) => (
          <li key={n.id}>{n.text}</li>
        ))}
      </ul>
    </section>
  )
}
