import { useState } from 'react'
import { useDb } from '../../app/context'
import { addLocalEvent } from '../../lib/events/localEvents'
import { addNotice } from '../../lib/notices/notices'
import { addTodo } from '../../lib/todos/todos'
import type { Suggestion } from '../../lib/command/skills'

const KIND: Record<Suggestion['kind'], string> = { notice: '전달사항', event: '일정', todo: '할 일' }

/** 고칠 수 있는 추천 카드: 칸마다 글·날짜·시간을 바로 고치고 '넣기'(하나씩) 또는 '모두 넣기'. 넣은 줄은 '넣음'. */
export default function SuggestCard({ items: init, today }: { items: Suggestion[]; today: string }) {
  const db = useDb()
  const [items, setItems] = useState(init)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [err, setErr] = useState<string>()
  const patch = (i: number, p: Partial<Suggestion>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)))
  async function put(i: number) {
    const s = items[i]
    if (!s.text.trim()) return setErr('내용을 쓰세요.')
    try {
      if (s.kind === 'notice') await addNotice(db, { text: s.text.trim(), start_date: s.date || today })
      if (s.kind === 'event') await addLocalEvent(db, { date: s.date || today, time: s.time || null, title: s.text.trim(), tag: '업무' })
      if (s.kind === 'todo') await addTodo(db, [s.text.trim()], s.date || null)
      setDone((d) => new Set(d).add(i))
      setErr(undefined)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  const left = items.map((_, i) => i).filter((i) => !done.has(i))
  return (
    <div className="suggest-card">
      <ul className="plain">
        {items.map((s, i) => (
          <li key={i} className={`suggest-row${done.has(i) ? ' done' : ''}`}>
            <span className={`suggest-kind k-${s.kind}`}>{KIND[s.kind]}</span>
            <textarea rows={Math.min(5, s.text.split('\n').length)} aria-label={`${KIND[s.kind]} ${i + 1} 내용`} className="pii" value={s.text} disabled={done.has(i)} onChange={(e) => patch(i, { text: e.target.value })} />
            <span className="suggest-when">
              <input type="date" aria-label={`${KIND[s.kind]} ${i + 1} ${s.kind === 'todo' ? '마감일' : '날짜'}`} value={s.date} disabled={done.has(i)} onChange={(e) => patch(i, { date: e.target.value })} />
              {s.kind === 'event' && <input type="time" aria-label={`일정 ${i + 1} 시간`} value={s.time ?? ''} disabled={done.has(i)} onChange={(e) => patch(i, { time: e.target.value })} />}
            </span>
            <button type="button" className="link" disabled={done.has(i)} onClick={() => void put(i)}>
              {done.has(i) ? '넣음' : '넣기'}
            </button>
          </li>
        ))}
      </ul>
      {left.length > 1 && (
        <button type="button" className="primary suggest-all" onClick={async () => { for (const i of left) await put(i) }}>
          {`모두 넣기(${left.length})`}
        </button>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  )
}
