import { useEffect, useRef, useState } from 'react'
import { deleteNotice } from '../../lib/notices/notices'
import { softDelete } from '../../lib/db/records'
import { deleteTodo } from '../../lib/todos/todos'
import { useDb } from '../../app/context'
import { addLocalEvent } from '../../lib/events/localEvents'
import { addNotice } from '../../lib/notices/notices'
import { addTodo } from '../../lib/todos/todos'
import type { Suggestion } from '../../lib/command/skills'

const KIND: Record<Suggestion['kind'], string> = { notice: '전달사항', event: '일정', todo: '할 일' }

/** 카드마다 넣은 줄(같은 창에서 다시 그려도 남게): cardKey → 줄 번호 → 넣은 기록 id·종류·넣은 때 */
const PUT = new Map<string, Map<number, { kind: Suggestion['kind']; id: string; at: number }>>()
const UNDO_MS = 5000

/** 고칠 수 있는 추천 카드: 칸마다 글·날짜·시간을 바로 고치고 '넣기'(하나씩) 또는 '모두 넣기'. 넣은 줄은 '넣음', 5초 안에 되돌리기. 넣는 중에는 다시 못 누른다. */
export default function SuggestCard({ items: init, today, cardKey = '' }: { items: Suggestion[]; today: string; cardKey?: string }) {
  const db = useDb()
  const [items, setItems] = useState(init)
  const put = useRef(PUT.get(cardKey) ?? new Map<number, { kind: Suggestion['kind']; id: string; at: number }>())
  if (cardKey) PUT.set(cardKey, put.current)
  const [, redraw] = useState(0)
  const busy = useRef(new Set<number>())
  const done = new Set(put.current.keys())
  const [err, setErr] = useState<string>()
  // 되돌리기 단추는 5초 뒤 사라진다
  useEffect(() => {
    const t = setInterval(() => redraw((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const patch = (i: number, p: Partial<Suggestion>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)))
  async function putOne(i: number) {
    const s = items[i]
    if (put.current.has(i) || busy.current.has(i)) return
    if (!s.text.trim()) return setErr('내용을 쓰세요.')
    busy.current.add(i)
    redraw((n) => n + 1)
    try {
      let id = ''
      if (s.kind === 'notice') id = (await addNotice(db, { text: s.text.trim(), start_date: s.date || today })).id
      if (s.kind === 'event') id = (await addLocalEvent(db, { date: s.date || today, time: s.time || null, title: s.text.trim(), tag: '업무' })).id
      if (s.kind === 'todo') id = (await addTodo(db, [s.text.trim()], s.date || null)).id
      put.current.set(i, { kind: s.kind, id, at: Date.now() })
      setErr(undefined)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      busy.current.delete(i)
      redraw((n) => n + 1)
    }
  }
  async function undo(i: number) {
    const r = put.current.get(i)
    if (!r) return
    if (r.kind === 'notice') await deleteNotice(db, r.id)
    if (r.kind === 'event') await softDelete(db.local_events, r.id)
    if (r.kind === 'todo') await deleteTodo(db, r.id)
    put.current.delete(i)
    redraw((n) => n + 1)
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
            <span className="suggest-act">
              <button type="button" className="link" disabled={done.has(i) || busy.current.has(i)} onClick={() => void putOne(i)}>
                {done.has(i) ? '넣음' : '넣기'}
              </button>
              {done.has(i) && Date.now() - put.current.get(i)!.at < UNDO_MS && (
                <button type="button" className="link" onClick={() => void undo(i)}>
                  되돌리기
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {left.length > 1 && (
        <button type="button" className="primary suggest-all" disabled={busy.current.size > 0} onClick={async () => { for (const i of left) await putOne(i) }}>
          {`모두 넣기(${left.length})`}
        </button>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  )
}
