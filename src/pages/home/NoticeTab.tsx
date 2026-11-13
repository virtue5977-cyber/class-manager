import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { atVisualEdge, caretNav, placeCaret, type CaretMove } from '../../lib/ui/caretNav'
import Icon from '../../components/Icon'
import { useAi, useDb, useFs } from '../../app/context'
import type { NoticeItemRec } from '../../lib/db/types'
import { addNotice, clearNoticesOn, deleteNotice, moveNotice, noticeDateGroups, noticesOn, reorderNotices, updateNotice, type NoticeDateGroup } from '../../lib/notices/notices'
import { dropIndex, reorderIds, startPointerDrag } from '../../lib/ui/pointerDrag'
import { splitNoticesByAi } from '../../lib/notices/aiSplit'
import { openNoticeNote } from '../../lib/notices/noteSync'
import { listNotes } from '../../lib/notes/notes'
import { matchNotes, mentionAt, parseNoteParts, type NoteTitle } from '../../lib/notes/noteLinks'
import NoteMentionList from '../../components/NoteMentionList'
import type { NoteRec } from '../../lib/db/types'
import { getCurrentClassId, listStudents } from '../../lib/roster/roster'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { exportPdf } from '../../lib/export/pdf'
import { useLive } from '../../lib/ui/useLive'
import ExportMenu from '../../components/ExportMenu'
import { Link, useNavigate } from 'react-router-dom'

const DRAFT = '__draft'
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
const period = (n: NoticeItemRec) => (n.start_date === n.end_date ? md(n.start_date) : `${md(n.start_date)}~${md(n.end_date)}`)
/** 줄에 보이는 날짜: 보고 있는 날 하루짜리는 쓰지 않는다 */
const periodShown = (n: NoticeItemRec, date: string) => (n.start_date === date && n.end_date === date ? '' : period(n))

/** 그날 전달사항: 체크 · 고정 · 순서 · 기간 · 지우기(되돌리기) · 직접 추가 · AI로 나누기 · 노트로 열기(짝 노트) · 내보내기. */
/** 글 길이에 맞춰 칸 높이를 늘린다(잘리지 않게) */
const grow = (el: HTMLTextAreaElement | null) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function NoticeTab({ date: home }: { date: string }) {
  /** 날짜별 목록에서 고른 날(없으면 받은 날) */
  const [view, setView] = useState<string>()
  const date = view ?? home
  const [byDate, setByDate] = useState(false)
  const db = useDb()
  const navigate = useNavigate()
  const fs = useFs()
  const ai = useAi()
  const list = useLive<NoticeItemRec[]>(() => noticesOn(db, date), [db, date], [])
  const groups = useLive<{ upcoming: NoticeDateGroup[]; ranges: NoticeDateGroup[]; past: NoticeDateGroup[] }>(() => (byDate ? noticeDateGroups(db, date) : Promise.resolve({ upcoming: [], ranges: [], past: [] })), [db, date, byDate], { upcoming: [], ranges: [], past: [] })
  const listRef = useRef<HTMLUListElement>(null)
  const [dragId, setDragId] = useState<string>()
  const [dropAt, setDropAt] = useState<number>()
  /** 손잡이를 끌어 순서 바꾸기(위·아래 모두) */
  function beginDrag(e: React.PointerEvent, id: string) {
    e.preventDefault()
    const ids = list.map((n) => n.id)
    const mids = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('li[data-id]') ?? []).map((li) => { const r = li.getBoundingClientRect(); return r.top + r.height / 2 })
    let at = -1
    startPointerDrag(e, {
      onStart: () => setDragId(id),
      onMove: (_x, y) => { at = dropIndex(mids(), y); setDropAt(at) },
      onDrop: () => { setDragId(undefined); setDropAt(undefined); if (at >= 0) void act(() => reorderNotices(db, date, reorderIds(ids, id, at))) },
      onCancel: () => { setDragId(undefined); setDropAt(undefined) },
    })
  }
  /** 새 줄(아직 저장 안 함). null이면 없음 */
  const [draft, setDraft] = useState<string | null>(null)
  const fields = useRef(new Map<string, HTMLTextAreaElement>())
  const pending = useRef<{ id: string; caret: number | 'end' } | null>(null)
  const ids = [...list.map((n) => n.id), ...(draft !== null ? [DRAFT] : [])]
  // 줄을 옮긴 뒤 초점·커서(새 줄은 그려진 다음에)
  useEffect(() => {
    const p = pending.current
    const el = p && fields.current.get(p.id)
    if (!p || !el) return
    pending.current = null
    el.focus()
    const c = p.caret === 'end' ? el.value.length : p.caret
    el.setSelectionRange(c, c)
  })
  const focusRow = (id: string, caret: number | 'end' = 'end') => {
    pending.current = { id, caret }
    const el = fields.current.get(id)
    if (el) {
      pending.current = null
      el.focus()
      const c = caret === 'end' ? el.value.length : caret
      el.setSelectionRange(c, c)
    }
  }
  /** 다음 줄로(마지막이면 새 빈 줄) */
  const goNext = (id: string) => {
    const i = ids.indexOf(id)
    if (i >= 0 && i < ids.length - 1) return focusRow(ids[i + 1])
    setDraft('')
    pending.current = { id: DRAFT, caret: 0 }
  }
  /** ↑↓←→: 첫·마지막 줄(또는 맨 앞·끝)에서 옆 줄로 */
  const arrow = (e: KeyboardEvent<HTMLTextAreaElement>, id: string): boolean => {
    const m: CaretMove | null = caretNav({ ...e, isComposing: e.nativeEvent.isComposing || e.keyCode === 229 }, e.currentTarget)
    if (!m || ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !atVisualEdge(e.currentTarget, m.dir))) return false
    const j = ids.indexOf(id) + m.dir
    const to = ids[j]
    const el = to && fields.current.get(to)
    if (!el) return false
    e.preventDefault()
    focusRow(to, placeCaret(el.value, m))
    return true
  }
  const fieldRef = (id: string) => (el: HTMLTextAreaElement | null) => {
    if (el) {
      fields.current.set(id, el)
      grow(el)
    } else fields.current.delete(id)
  }
  // '@'로 노트 연결: 어느 줄에서, 어디부터, 무엇을 찾는지
  const notes = useLive<NoteRec[]>(() => listNotes(db), [db], [])
  const [men, setMen] = useState<{ id: string; start: number; q: string; caret: number }>()
  const [menSel, setMenSel] = useState(0)
  const menItems: NoteTitle[] = men ? matchNotes(notes, men.q) : []
  const watchMention = (id: string, el: HTMLTextAreaElement) => {
    const c = el.selectionStart ?? el.value.length
    const m = mentionAt(el.value, c)
    setMen(m ? { id, ...m, caret: c } : undefined)
    setMenSel(0)
  }
  const pickMention = (id: string, n: NoteTitle) => {
    const el = fields.current.get(id)
    if (!el || !men) return
    const v = `${el.value.slice(0, men.start)}@${n.title} ${el.value.slice(men.caret)}`
    const c = men.start + n.title.length + 2
    if (id === DRAFT) setDraft(v)
    else el.value = v
    setMen(undefined)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(c, c)
      grow(el)
    })
  }
  /** 노트 후보가 열려 있으면 ↑↓·Enter·Tab·Esc는 후보가 먼저 */
  const mentionKey = (e: KeyboardEvent<HTMLTextAreaElement>, id: string): boolean => {
    if (!men || men.id !== id || !menItems.length || e.nativeEvent.isComposing || e.keyCode === 229) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setMenSel((i) => (i + (e.key === 'ArrowDown' ? 1 : menItems.length - 1)) % menItems.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pickMention(id, menItems[Math.min(menSel, menItems.length - 1)])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setMen(undefined)
      return true
    }
    return false
  }
  const partsOf = (text: string) => parseNoteParts(text, notes)
  /** 고치는 중인 줄(@노트 링크 보기 대신 글칸) */
  const [editing, setEditing] = useState<string>()
  const hasLink = (n: NoticeItemRec) => !!n.parts?.some((p) => typeof p !== 'string' && 'note' in p)
  const [msg, setMsg] = useState<string>()
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<void> }>()
  const [rangeFor, setRangeFor] = useState<string>()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>) => {
    try {
      setMsg(undefined)
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }
  const rows = () => list.map((n, i) => [String(i + 1), n.text, period(n), n.done ? '완료' : ''])
  async function exportAs(kind: 'hwpx' | 'xlsx') {
    const header = ['번호', '전달사항', '기간', '완료']
    const name = `전달사항_${date}.${kind}`
    const bytes = kind === 'hwpx' ? await buildTableHwpx({ title: `${md(date)} 전달사항`, header, rows: rows(), colRatios: [1, 8, 2, 1] }) : await writeSimpleXlsx('전달사항', [header, ...rows()])
    fs.downloadFile(name, bytes)
  }

  return (
    <section className="notice-tab stack" aria-label="전달사항">
      <div className="row between">
        <span className="row">
          <strong>{`${md(date)} 전달사항 ${list.length}개`}</strong>
          {view && view !== home && (
            <button type="button" className="link" onClick={() => setView(undefined)}>
              보던 날로
            </button>
          )}
        </span>
        <div className="row notice-tools" role="toolbar" aria-label="전달사항 도구">
          <button type="button" className="icon-btn tool-ico" aria-label="가져오기(붙여넣어 AI로 나누기)" title="가져오기 — 붙여넣어 AI로 나누기" aria-pressed={pasteOpen} onClick={() => setPasteOpen((v) => !v)}>
            <Icon name="upload" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn tool-ico"
            aria-label="노트로 열기"
            title="노트로 열기 — 이날 전달사항이 노트 한 장과 이어집니다(어느 쪽에서 고쳐도 같이 바뀜)"
            onClick={() => act(async () => {
              const n = await openNoticeNote(db, date)
              navigate(`/notes?id=${n.id}`)
            })}
          >
            <Icon name="noteAdd" size={16} />
          </button>
          <button type="button" className="icon-btn tool-ico" aria-label="날짜별 전달사항" title="날짜별 — 다른 날 전달사항 보기" aria-pressed={byDate} onClick={() => setByDate((v) => !v)}>
            <Icon name="calendar" size={16} />
          </button>
          <ExportMenu icon items={[{ format: 'hwpx', run: () => exportAs('hwpx') }, { format: 'xlsx', run: () => exportAs('xlsx') }, { format: 'pdf', run: () => exportPdf(`전달사항_${date}.pdf`) }]} />
          <button type="button" className="icon-btn tool-ico" aria-label="전체 지우기" title="이날 전달사항 전체 지우기" disabled={!list.length} onClick={() => setConfirmClear(true)}>
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
      {confirmClear && (
        <p className="row confirm-inline" role="group" aria-label="전체 지우기 확인">
          <span>{`${md(date)} 전달사항 ${list.length}개를 모두 지울까요?`}</span>
          <button type="button" className="danger" onClick={() => act(async () => { setConfirmClear(false); const n = list.length; setUndo({ text: `전달사항 ${n}개`, run: await clearNoticesOn(db, date) }) })}>
            모두 지우기
          </button>
          <button type="button" className="link" onClick={() => setConfirmClear(false)}>취소</button>
        </p>
      )}
      {pasteOpen && (
        <div className="card stack">
          <label className="wide">
            붙여 넣을 글
            <textarea rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="학교 메신저·공문 글을 그대로 붙여 넣으세요." />
          </label>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => act(async () => {
                setBusy(true)
                try {
                  const cid = await getCurrentClassId(db)
                  const names = cid ? (await listStudents(db, cid)).map((s) => s.name) : []
                  const items = await splitNoticesByAi(db, ai, raw, date, names)
                  for (const t of items) await addNotice(db, { text: t, start_date: date })
                  setRaw('')
                  setPasteOpen(false)
                  setMsg(`${items.length}개를 넣었습니다. 확인하고 고치세요.`)
                } finally {
                  setBusy(false)
                }
              })}
            >
              {busy ? '나누는 중…' : 'AI로 나누기'}
            </button>
            <Link to="/settings?tab=ai" className="muted">AI 설정</Link>
          </div>
        </div>
      )}
      {byDate && (
        <section className="notice-dates card" aria-label="날짜별 전달사항">
          {groups.upcoming.length + groups.ranges.length + groups.past.length === 0 && <p className="muted">다른 날 전달사항이 없습니다.</p>}
          {[...groups.upcoming, ...groups.ranges].map((g) => (
            <DateGroup key={g.key} g={g} current={date} onView={() => setView(g.start)} onDelete={(n) => act(async () => setUndo({ text: n.text, run: await deleteNotice(db, n.id) }))} />
          ))}
          {groups.past.length > 0 && (
            <details>
              <summary>{`지난 날짜 ${groups.past.length}`}</summary>
              {groups.past.map((g) => (
                <DateGroup key={g.key} g={g} current={date} onView={() => setView(g.start)} onDelete={(n) => act(async () => setUndo({ text: n.text, run: await deleteNotice(db, n.id) }))} />
              ))}
            </details>
          )}
        </section>
      )}
      {msg && <p className="notice" role="status">{msg}</p>}
      {undo && (
        <p className="row">
          <span className="muted">{`'${undo.text}'을(를) 지웠습니다.`}</span>
          <button type="button" className="link" onClick={() => act(async () => { await undo.run(); setUndo(undefined) })}>
            되돌리기
          </button>
        </p>
      )}
      <ul className="plain notice-list" aria-label="전달사항 목록" ref={listRef}>
        {list.map((n, i) => (
          <li key={n.id} data-id={n.id} className={`notice-row${n.done ? ' done' : ''}${n.pinned ? ' pinned' : ''}${dragId === n.id ? ' dragging' : ''}${dropAt === i ? ' drop-before' : ''}${dropAt === list.length && i === list.length - 1 ? ' drop-after' : ''}`}>
            <span className="drag-grip" role="button" tabIndex={-1} aria-label={`${n.text} 끌어서 순서 바꾸기`} title="끌어서 순서 바꾸기" onPointerDown={(e) => beginDrag(e, n.id)}>
              <Icon name="grip" size={14} />
            </span>
            <input type="checkbox" aria-label={`${n.text} 완료`} checked={n.done} onChange={(e) => act(() => updateNotice(db, n.id, { done: e.target.checked }))} />
            <span className={`notice-box${hasLink(n) ? ' has-links' : ''}${editing === n.id ? ' editing' : ''}`}>
            {/* @노트가 든 줄은 고치지 않을 때 글 안의 '@노트이름'이 그대로 링크(할 일처럼). 링크 밖을 누르면 고치기. */}
            {hasLink(n) && editing !== n.id && (
              <span
                className="notice-view pii"
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest('a')) return
                  e.preventDefault()
                  setEditing(n.id)
                  requestAnimationFrame(() => {
                    const el = document.querySelector<HTMLTextAreaElement>(`li[data-id="${n.id}"] textarea.notice-text`)
                    el?.focus()
                    el?.setSelectionRange(el.value.length, el.value.length)
                  })
                }}
              >
                {(n.parts ?? []).map((p, k) =>
                  typeof p === 'string' ? (
                    <span key={k}>{p}</span>
                  ) : 'note' in p ? (
                    notes.some((x) => x.id === p.note) ? (
                      <Link key={k} to={`/notes?id=${p.note}`} className="note-link" title="노트 열기">{`@${notes.find((x) => x.id === p.note)!.title}`}</Link>
                    ) : (
                      <span key={k} className="dead" title="지운 노트입니다">@지운 노트</span>
                    )
                  ) : null,
                )}
              </span>
            )}
            <textarea
              rows={1}
              className="notice-text"
              aria-label={`${i + 1}번 내용`}
              onFocus={() => setEditing(n.id)}
              defaultValue={n.text}
              key={n.text}
              ref={fieldRef(n.id)}
              onInput={(e) => {
                grow(e.currentTarget)
                watchMention(n.id, e.currentTarget)
              }}
              onKeyDown={(e) => {
                if (mentionKey(e, n.id)) return
                if (arrow(e, n.id)) return
                // Enter는 저장하고 다음 줄로(줄바꿈은 Shift+Enter). 저장은 떠날 때(blur) 한다.
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault()
                  const el = e.currentTarget
                  goNext(n.id)
                  if (document.activeElement === el) el.blur()
                }
              }}
              onBlur={(e) => {
                setMen(undefined)
                setEditing((x) => (x === n.id ? undefined : x))
                const v = e.target.value.trim()
                // 다 지우고 떠나면 그 줄을 없앤다(되돌리기 가능)
                if (!v) return void act(async () => setUndo({ text: n.text, run: await deleteNotice(db, n.id) }))
                const parts = partsOf(v)
                if (v !== n.text || JSON.stringify(parts) !== JSON.stringify(n.parts)) act(() => updateNotice(db, n.id, { text: e.target.value, parts }))
              }}
            />
            {men?.id === n.id && <NoteMentionList items={menItems} sel={menSel} onPick={(x) => pickMention(n.id, x)} />}
            <span className="row-tools">
            {!periodShown(n, date) && (
              <button type="button" className="icon-btn" aria-label={`${n.text} 날짜 정하기`} title="날짜·기간 정하기" onClick={() => setRangeFor(rangeFor === n.id ? undefined : n.id)}>
                <Icon name="calendar" size={14} />
              </button>
            )}
            <button type="button" className={`icon-btn${n.pinned ? ' on' : ''}`} aria-label={`${n.text} 고정`} aria-pressed={n.pinned} onClick={() => act(() => updateNotice(db, n.id, { pinned: !n.pinned }))}>
              <Icon name="pin" size={14} />
            </button>
            <button type="button" className="icon-btn" aria-label={`${n.text} 위로`} disabled={i === 0} onClick={() => act(() => moveNotice(db, date, n.id, -1))}>↑</button>
            <button type="button" className="icon-btn" aria-label={`${n.text} 아래로`} disabled={i === list.length - 1} onClick={() => act(() => moveNotice(db, date, n.id, 1))}>↓</button>
            <button type="button" className="icon-btn" aria-label={`${n.text} 지우기`} onClick={() => act(async () => setUndo({ text: n.text, run: await deleteNotice(db, n.id) }))}>×</button>
            </span>
            <button type="button" className="notice-period link" aria-label={`${n.text} 기간 고치기`} onClick={() => setRangeFor(rangeFor === n.id ? undefined : n.id)}>
              {periodShown(n, date)}
            </button>
            </span>
            {rangeFor === n.id && (
              <span className="row notice-range">
                <input type="date" aria-label="시작" defaultValue={n.start_date} onChange={(e) => e.target.value && act(() => updateNotice(db, n.id, { start_date: e.target.value }))} />
                ~
                <input type="date" aria-label="끝" defaultValue={n.end_date} onChange={(e) => e.target.value && act(() => updateNotice(db, n.id, { end_date: e.target.value }))} />
              </span>
            )}
          </li>
        ))}
        {draft !== null && (
          <li className="notice-row draft">
            <span className="drag-grip" aria-hidden="true" />
            <input type="checkbox" aria-hidden="true" tabIndex={-1} disabled />
            <span className="notice-box">
              <textarea
                rows={1}
                className="notice-text"
                aria-label="새 전달사항 줄"
                placeholder="전달사항을 쓰고 Enter"
                value={draft}
                ref={fieldRef(DRAFT)}
                onChange={(e) => {
                  setDraft(e.target.value)
                  grow(e.target)
                  watchMention(DRAFT, e.target)
                }}
                onKeyDown={(e) => {
                  if (mentionKey(e, DRAFT)) return
                  if (arrow(e, DRAFT)) return
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault()
                    const t = draft.trim()
                    if (!t) return
                    setDraft('')
                    act(() => addNotice(db, { text: t, start_date: date, end_date: date, parts: partsOf(t) }))
                  }
                }}
                onBlur={() => {
                  setMen(undefined)
                  const t = (draft ?? '').trim()
                  setDraft(null)
                  if (t) act(() => addNotice(db, { text: t, start_date: date, end_date: date, parts: partsOf(t) }))
                }}
              />
              {men?.id === DRAFT && <NoteMentionList items={menItems} sel={menSel} onPick={(x) => pickMention(DRAFT, x)} />}
            </span>
          </li>
        )}
        {list.length === 0 && draft === null && <li className="muted">이날 전달사항이 없습니다.</li>}
      </ul>
      <button type="button" className="link notice-add-btn" onClick={() => { setDraft((d) => d ?? ''); pending.current = { id: DRAFT, caret: 'end' } }}>
        + 추가
      </button>
    </section>
  )
}

/** 날짜별 목록의 한 묶음: 날짜(누르면 그날 보기)와 항목(마우스 올리면 지우기) */
function DateGroup({ g, current, onView, onDelete }: { g: NoticeDateGroup; current: string; onView: () => void; onDelete: (n: NoticeItemRec) => void }) {
  return (
    <div className={`notice-date-group${g.start === current ? ' on' : ''}`}>
      <button type="button" className="link notice-date" aria-label={`${g.label} 보기`} onClick={onView}>
        {g.label}
      </button>
      <ul className="plain">
        {g.items.map((n) => (
          <li key={n.id} className={`row notice-date-item${n.done ? ' done' : ''}`}>
            <span className="pii">{n.text.split('\n')[0]}</span>
            <button type="button" className="icon-btn" aria-label={`${n.text} 지우기`} onClick={() => onDelete(n)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
