import { useState } from 'react'
import Icon from '../../components/Icon'
import { useAi, useDb, useFs } from '../../app/context'
import type { NoticeItemRec } from '../../lib/db/types'
import { addNotice, deleteNotice, moveNotice, noticesOn, updateNotice } from '../../lib/notices/notices'
import { splitNoticesByAi } from '../../lib/notices/aiSplit'
import { createNote, newBlockId } from '../../lib/notes/notes'
import { getCurrentClassId, listStudents } from '../../lib/roster/roster'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { exportPdf } from '../../lib/export/pdf'
import { useLive } from '../../lib/ui/useLive'
import ExportMenu from '../../components/ExportMenu'
import { Link } from 'react-router-dom'

const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
const period = (n: NoticeItemRec) => (n.start_date === n.end_date ? md(n.start_date) : `${md(n.start_date)}~${md(n.end_date)}`)

/** 그날 전달사항: 체크 · 고정 · 순서 · 기간 · 지우기(되돌리기) · 직접 추가 · AI로 나누기 · 노트로 보내기 · 내보내기. */
/** 글 길이에 맞춰 칸 높이를 늘린다(잘리지 않게) */
const grow = (el: HTMLTextAreaElement | null) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function NoticeTab({ date }: { date: string }) {
  const db = useDb()
  const fs = useFs()
  const ai = useAi()
  const list = useLive<NoticeItemRec[]>(() => noticesOn(db, date), [db, date], [])
  const [text, setText] = useState('')
  const [start, setStart] = useState(date)
  const [end, setEnd] = useState(date)
  const [msg, setMsg] = useState<string>()
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<void> }>()
  const [rangeFor, setRangeFor] = useState<string>()
  const [pasteOpen, setPasteOpen] = useState(false)
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
        <strong>{`${md(date)} 전달사항 ${list.length}개`}</strong>
        <div className="row">
          <button type="button" className="link" onClick={() => setPasteOpen((v) => !v)}>
            붙여넣어 AI로 나누기
          </button>
          <button
            type="button"
            className="link"
            disabled={!list.length}
            onClick={() => act(async () => {
              const n = await createNote(db, `${md(date)} 전달사항`, list.map((x) => ({ id: newBlockId(), type: 'check' as const, text: x.text, checked: x.done })))
              setMsg(`노트 '${n.title}'로 보냈습니다.`)
            })}
          >
            노트로 보내기
          </button>
          <ExportMenu items={[{ format: 'hwpx', run: () => exportAs('hwpx') }, { format: 'xlsx', run: () => exportAs('xlsx') }, { format: 'pdf', run: () => exportPdf(`전달사항_${date}.pdf`) }]} />
        </div>
      </div>
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
      {msg && <p className="notice" role="status">{msg}</p>}
      {undo && (
        <p className="row">
          <span className="muted">{`'${undo.text}'을(를) 지웠습니다.`}</span>
          <button type="button" className="link" onClick={() => act(async () => { await undo.run(); setUndo(undefined) })}>
            되돌리기
          </button>
        </p>
      )}
      <ul className="plain notice-list" aria-label="전달사항 목록">
        {list.map((n, i) => (
          <li key={n.id} className={`notice-row${n.done ? ' done' : ''}${n.pinned ? ' pinned' : ''}`}>
            <input type="checkbox" aria-label={`${n.text} 완료`} checked={n.done} onChange={(e) => act(() => updateNotice(db, n.id, { done: e.target.checked }))} />
            <textarea
              rows={1}
              className="notice-text"
              aria-label={`${i + 1}번 내용`}
              defaultValue={n.text}
              key={n.text}
              ref={grow}
              onInput={(e) => grow(e.currentTarget)}
              onKeyDown={(e) => {
                // Enter는 저장(줄바꿈은 Shift+Enter)
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              onBlur={(e) => e.target.value.trim() !== n.text && act(() => updateNotice(db, n.id, { text: e.target.value }))}
            />
            <button type="button" className="notice-period link" aria-label={`${n.text} 기간 고치기`} onClick={() => setRangeFor(rangeFor === n.id ? undefined : n.id)}>
              {period(n)}
            </button>
            <span className="row-tools">
            <button type="button" className={`icon-btn${n.pinned ? ' on' : ''}`} aria-label={`${n.text} 고정`} aria-pressed={n.pinned} onClick={() => act(() => updateNotice(db, n.id, { pinned: !n.pinned }))}>
              <Icon name="pin" size={14} />
            </button>
            <button type="button" className="icon-btn" aria-label={`${n.text} 위로`} disabled={i === 0} onClick={() => act(() => moveNotice(db, date, n.id, -1))}>↑</button>
            <button type="button" className="icon-btn" aria-label={`${n.text} 아래로`} disabled={i === list.length - 1} onClick={() => act(() => moveNotice(db, date, n.id, 1))}>↓</button>
            <button type="button" className="icon-btn" aria-label={`${n.text} 지우기`} onClick={() => act(async () => setUndo({ text: n.text, run: await deleteNotice(db, n.id) }))}>×</button>
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
        {list.length === 0 && <li className="muted">이날 전달사항이 없습니다.</li>}
      </ul>
      <form
        className="row notice-add"
        onSubmit={(e) => {
          e.preventDefault()
          act(async () => {
            await addNotice(db, { text, start_date: start, end_date: end })
            setText('')
          })
        }}
      >
        <input aria-label="새 전달사항" value={text} onChange={(e) => setText(e.target.value)} placeholder="전달사항 직접 추가" />
        <input type="date" aria-label="시작 날짜" value={start} onChange={(e) => setStart(e.target.value)} />
        ~
        <input type="date" aria-label="끝 날짜" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button type="submit">추가</button>
      </form>
    </section>
  )
}
