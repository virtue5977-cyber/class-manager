import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/context'
import type { LocalEventRec } from '../../lib/db/types'
import { deleteLocalEvent, updateLocalEvent } from '../../lib/events/localEvents'

/** 상세에 띄울 일정: 내 일정은 고치기·지우기, 받은 일정(학사·구글)은 보기만 */
export type DetailItem =
  | { kind: 'local'; ev: LocalEventRec }
  | { kind: 'school' | 'google'; title: string; date: string; end_date?: string | null; time?: string | null; place?: string; memo?: string }

const SOURCE = { school: '학사일정', google: '구글 캘린더' } as const
const dayText = (d: string, end?: string | null) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일${end && end !== d ? ` ~ ${Number(end.slice(5, 7))}월 ${Number(end.slice(8))}일` : ''}`

export default function EventDetail({ item, onClose, onChanged }: { item: DetailItem; onClose: () => void; onChanged: () => void }) {
  const db = useDb()
  const box = useRef<HTMLDivElement>(null)
  const local = item.kind === 'local' ? item.ev : undefined
  const [f, setF] = useState(() => ({
    title: local?.title ?? '',
    date: local?.date ?? '',
    end: local?.end_date ?? '',
    time: local?.time ?? '',
    place: local?.place ?? '',
    memo: local?.memo ?? '',
    tag: local?.tag ?? ('업무' as LocalEventRec['tag']),
  }))
  const [ask, setAsk] = useState(false)
  const [err, setErr] = useState<string>()
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose())
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])

  async function saveIt() {
    if (!local) return
    try {
      await updateLocalEvent(db, local.id, { title: f.title, date: f.date, end_date: f.end || null, time: f.time || null, place: f.place, memo: f.memo, tag: f.tag })
      onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  async function removeIt() {
    if (!local) return
    await deleteLocalEvent(db, local.id)
    onChanged()
    onClose()
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card stack" role="dialog" aria-modal="true" aria-label="일정 상세" ref={box}>
        {local ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              void saveIt()
            }}
          >
            <label className="field">
              <span>제목</span>
              <input aria-label="제목" value={f.title} onChange={set('title')} />
            </label>
            <div className="row">
              <label className="field">
                <span>날짜</span>
                <input type="date" aria-label="날짜" value={f.date} onChange={set('date')} />
              </label>
              <label className="field">
                <span>끝 날짜</span>
                <input type="date" aria-label="끝 날짜" value={f.end} min={f.date} onChange={set('end')} />
              </label>
              <label className="field">
                <span>시각</span>
                <input type="time" aria-label="시각" value={f.time} onChange={set('time')} />
              </label>
            </div>
            <div className="row">
              <label className="field grow">
                <span>장소</span>
                <input aria-label="장소" value={f.place} onChange={set('place')} placeholder="예: 3층 시청각실" />
              </label>
              <label className="field">
                <span>구분</span>
                <select aria-label="구분" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value as LocalEventRec['tag'] })}>
                  <option value="업무">업무</option>
                  <option value="개인">개인</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>메모</span>
              <textarea aria-label="메모" rows={3} value={f.memo} onChange={set('memo')} />
            </label>
            {err && <p className="error">{err}</p>}
            <div className="row modal-actions">
              {ask ? (
                <span className="row" role="group" aria-label="지우기 확인">
                  <span>이 일정을 지울까요?</span>
                  <button type="button" className="danger" onClick={() => void removeIt()}>정말 지우기</button>
                  <button type="button" onClick={() => setAsk(false)}>그만두기</button>
                </span>
              ) : (
                <button type="button" className="danger-text" onClick={() => setAsk(true)}>지우기</button>
              )}
              <span className="grow" />
              <button type="button" onClick={onClose}>닫기</button>
              <button type="submit" className="primary">저장</button>
            </div>
          </form>
        ) : (
          item.kind !== 'local' && (
            <>
              <span className={`up-tag ${item.kind === 'school' ? 'tag-school' : 'tag-google'}`}>{SOURCE[item.kind]}</span>
              <h3>{item.title}</h3>
              <p>{`${dayText(item.date, item.end_date)}${item.time ? ` ${item.time}` : ''}`}</p>
              {item.place && <p>{`장소: ${item.place}`}</p>}
              {item.memo && <p className="muted">{item.memo}</p>}
              <p className="muted">{item.kind === 'school' ? '학사일정은 나이스에서 받아 옵니다. 여기서는 고칠 수 없습니다.' : '구글에서 받은 일정은 구글 캘린더에서 고치세요.'}</p>
              <div className="row modal-actions">
                <span className="grow" />
                <button type="button" onClick={onClose}>닫기</button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
