import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDb, useFs } from '../../app/context'
import type { NoteRec, TodoRec } from '../../lib/db/types'
import { createNote, deleteNote, listNotes, noteText, setPinned } from '../../lib/notes/notes'
import { setTodoDone, todosLinkingNote } from '../../lib/todos/todos'
import { buildTableHwpx } from '../../lib/docs/table-doc'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { exportPdf } from '../../lib/export/pdf'
import { toYmd } from '../../lib/schoolDays'
import { useLive } from '../../lib/ui/useLive'
import ExportMenu from '../../components/ExportMenu'
import PageHead from '../../components/PageHead'
import NoteEditor from './NoteEditor'

/** 노트함: 왼쪽 목록(찾기·고정·지우기) + 오른쪽 편집. */
export default function NotesPage({ today = toYmd(new Date()) }: { today?: string }) {
  const db = useDb()
  const fs = useFs()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id')
  const notes = useLive<NoteRec[]>(() => listNotes(db), [db], [])
  const [q, setQ] = useState('')
  const [confirmDel, setConfirmDel] = useState<string>()
  const [current, setCurrent] = useState<NoteRec | null>(null)
  useEffect(() => {
    if (!id) return setCurrent(null)
    db.notes.get(id).then((n) => setCurrent(n && !n.deleted ? n : null))
  }, [db, id])
  const todos = useLive<TodoRec[]>(() => (id ? todosLinkingNote(db, id) : Promise.resolve([])), [db, id], [])
  const shown = useMemo(() => (q.trim() ? notes.filter((n) => noteText(n).includes(q.trim())) : notes), [notes, q])

  async function exportAs(kind: 'hwpx' | 'xlsx') {
    if (!current) return
    const n = (await db.notes.get(current.id)) ?? current
    const name = `${(n.title || '노트').replace(/[\\/:*?"<>|\s]+/g, '_')}.${kind}`
    if (kind === 'xlsx') {
      const rows = n.blocks.flatMap((b) =>
        b.type === 'roster' ? [['', b.text || '학생 체크 표'], ...(b.rows ?? []).map((r) => [r.checked ? '☑' : '☐', r.label])] : ['check', 'bullet', 'number', 'p'].includes(b.type) && (b.text ?? '').trim() ? [[b.type === 'check' ? (b.checked ? '☑' : '☐') : '', b.text ?? '']] : [],
      )
      fs.downloadFile(name, await writeSimpleXlsx('노트', [['체크', '내용'], ...rows]))
    } else {
      const rows = n.blocks.flatMap((b) =>
        b.type === 'roster' ? [['■', b.text || '학생 체크 표'], ...(b.rows ?? []).map((r) => [r.checked ? '☑' : '☐', r.label])] : (b.text ?? '').trim() ? [[b.type === 'check' ? (b.checked ? '☑' : '☐') : b.type === 'bullet' ? '•' : b.type.startsWith('h') ? '■' : '', b.text ?? '']] : [],
      )
      fs.downloadFile(name, await buildTableHwpx({ title: n.title || '노트', header: ['', '내용'], rows, colRatios: [1, 12] }))
    }
  }

  return (
    <section className="stack notes-page">
      <PageHead title="노트함" summary={`노트 ${notes.length}개`}>
        <button type="button" className="primary" onClick={async () => navigate(`/notes?id=${(await createNote(db)).id}`)}>
          + 새 노트
        </button>
        {current && <ExportMenu items={[{ format: 'hwpx', run: () => exportAs('hwpx') }, { format: 'xlsx', run: () => exportAs('xlsx') }, { format: 'pdf', run: () => exportPdf(`${current.title || '노트'}.pdf`) }]} />}
      </PageHead>
      <div className="notes-layout">
        <div className="notes-list stack">
          <input type="search" aria-label="노트 찾기" placeholder="제목·내용 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="plain" aria-label="노트 목록">
            {shown.map((n) => (
              <li key={n.id} className={`note-item${n.id === id ? ' on' : ''}`}>
                <Link to={`/notes?id=${n.id}`}>{n.title || '제목 없음'}</Link>
                {n.blocks.some((b) => b.type === 'file') && <span title="첨부 있음" aria-label="첨부 있음">📎</span>}
                <button type="button" className={`icon-btn${n.pinned ? ' on' : ''}`} aria-label={`${n.title} 고정`} aria-pressed={n.pinned} onClick={() => setPinned(db, n.id, !n.pinned)}>
              <Icon name="pin" size={14} />
            </button>
                <button type="button" className="icon-btn" aria-label={`${n.title} 지우기`} onClick={() => setConfirmDel(n.id)}>×</button>
                {confirmDel === n.id && (
                  <span className="row confirm-inline" role="group" aria-label="노트 지우기 확인">
                    <button type="button" className="danger" onClick={async () => { setConfirmDel(undefined); await deleteNote(db, n.id); if (n.id === id) navigate('/notes') }}>정말 지우기</button>
                    <button type="button" className="link" onClick={() => setConfirmDel(undefined)}>취소</button>
                  </span>
                )}
              </li>
            ))}
            {shown.length === 0 && <li className="muted">노트가 없습니다.</li>}
          </ul>
        </div>
        <div className="notes-main stack">
          {current ? (
            <>
              {todos.length > 0 && (
                <section className="panel-card" aria-label="이 노트를 가리키는 할 일">
                  <h3>이 노트를 가리키는 할 일</h3>
                  <ul className="plain">
                    {todos.map((t) => (
                      <li key={t.id}>
                        <label className="check">
                          <input type="checkbox" checked={t.done} onChange={(e) => setTodoDone(db, t.id, e.target.checked)} />
                          {t.parts.map((p) => (typeof p === 'string' ? p : 'note' in p ? (current.title || '이 노트') : '학생')).join('')}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <NoteEditor key={current.id} note={current} today={today} />
            </>
          ) : (
            <p className="muted">왼쪽에서 노트를 고르거나 새 노트를 만드세요.</p>
          )}
        </div>
      </div>
    </section>
  )
}
