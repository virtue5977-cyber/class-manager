import { useEffect, useMemo, useState, type DragEvent } from 'react'
import Icon from '../../components/Icon'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDb, useFs } from '../../app/context'
import type { NoteRec, TodoRec } from '../../lib/db/types'
import { createNote, deleteNote, listNotes, noteText, setPinned } from '../../lib/notes/notes'
import { addFolder, deleteFolder, folderTree, listFolders, moveFolder, moveNote, renameFolder, MAX_FOLDER_DEPTH, type FolderNode } from '../../lib/notes/noteFolders'
import type { NoteFolder } from '../../lib/db/types'
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
  const folders = useLive<NoteFolder[]>(() => listFolders(db), [db], [])
  /** 고른 폴더(새 노트·새 폴더가 들어갈 곳). null = 맨 위 */
  const [folder, setFolder] = useState<string | null>(null)
  const [openF, setOpenF] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('watson.notes.open') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggleF = (id: string, on?: boolean) =>
    setOpenF((s) => {
      const n = new Set(s)
      if (on ?? !n.has(id)) n.add(id)
      else n.delete(id)
      try {
        localStorage.setItem('watson.notes.open', JSON.stringify([...n]))
      } catch {
        /* 기억 못 해도 됨 */
      }
      return n
    })
  const [edit, setEdit] = useState<{ id: string; name: string }>()
  const [confirmF, setConfirmF] = useState<string>()
  const [fmsg, setFmsg] = useState<string>()
  const [dragNote, setDragNote] = useState<string>()
  const [dragFolder, setDragFolder] = useState<string>()
  const [dropOn, setDropOn] = useState<string>()
  const tree = useMemo(() => folderTree(folders, notes), [folders, notes])
  const fAct = async (fn: () => Promise<unknown>) => {
    try {
      setFmsg(undefined)
      await fn()
    } catch (e) {
      setFmsg(e instanceof Error ? e.message : String(e))
    }
  }
  /** 폴더 줄·맨 위에 놓기: 노트면 그 폴더로, 폴더면 그 아래로 */
  const dropTo = (target: string | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!dragNote && !dragFolder) return
      e.preventDefault()
      setDropOn(target ?? '__top')
    },
    onDragLeave: () => setDropOn(undefined),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      setDropOn(undefined)
      const n = dragNote
      const f = dragFolder
      setDragNote(undefined)
      setDragFolder(undefined)
      if (n) fAct(() => moveNote(db, n, target))
      else if (f && f !== target) fAct(() => moveFolder(db, f, target))
      if (target) toggleF(target, true)
    },
  })
  const folderOptions = useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (nodes: FolderNode[], depth: number) => nodes.forEach((x) => (out.push({ id: x.folder.id, label: `${'　'.repeat(depth)}${x.folder.name}` }), walk(x.folders, depth + 1)))
    walk(tree.folders, 0)
    return out
  }, [tree])
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

  const noteRow = (n: NoteRec, depth = 0) => (
    <li key={n.id} className={`note-item${n.id === id ? ' on' : ''}`} style={depth ? { paddingLeft: 8 + depth * 16 } : undefined} draggable={!q.trim()} onDragStart={() => setDragNote(n.id)} onDragEnd={() => setDragNote(undefined)}>
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
  )
  const folderRows = (nodes: FolderNode[], depth: number): React.ReactNode[] =>
    nodes.flatMap((x) => {
      const f = x.folder
      const open = openF.has(f.id)
      return [
        <li key={`f-${f.id}`} className={`folder-item${folder === f.id ? ' on' : ''}${dropOn === f.id ? ' drop' : ''}`} style={{ paddingLeft: 4 + depth * 16 }} draggable={edit?.id !== f.id} onDragStart={(e) => (e.stopPropagation(), setDragFolder(f.id))} onDragEnd={() => setDragFolder(undefined)} {...dropTo(f.id)}>
          <button type="button" className="icon-btn folder-twisty" aria-label={`${f.name} ${open ? '접기' : '펴기'}`} aria-expanded={open} onClick={() => toggleF(f.id)}>{open ? '▾' : '▸'}</button>
          {edit?.id === f.id ? (
            <input
              autoFocus
              aria-label="폴더 이름"
              value={edit.name}
              onChange={(e) => setEdit({ id: f.id, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') (e.preventDefault(), fAct(async () => { await renameFolder(db, f.id, edit.name); setEdit(undefined) }))
                if (e.key === 'Escape') setEdit(undefined)
              }}
              onBlur={() => edit.name.trim() && edit.name !== f.name ? fAct(async () => { await renameFolder(db, f.id, edit.name); setEdit(undefined) }) : setEdit(undefined)}
            />
          ) : (
            <button type="button" className="folder-name" aria-label={`${f.name} 폴더(노트 ${x.count}개)`} aria-pressed={folder === f.id} onClick={() => { setFolder(folder === f.id ? null : f.id); toggleF(f.id, true) }} onDoubleClick={() => setEdit({ id: f.id, name: f.name })}>
              <span aria-hidden="true">📁</span> {f.name} <span className="muted">{x.count}</span>
            </button>
          )}
          <span className="folder-tools">
            {depth + 1 < MAX_FOLDER_DEPTH && <button type="button" className="icon-btn" aria-label={`${f.name} 안에 폴더`} title="하위 폴더" onClick={() => fAct(async () => { const nf = await addFolder(db, '새 폴더', f.id); toggleF(f.id, true); setEdit({ id: nf.id, name: nf.name }) })}>+</button>}
            <button type="button" className="icon-btn" aria-label={`${f.name} 이름 바꾸기`} title="이름 바꾸기" onClick={() => setEdit({ id: f.id, name: f.name })}>✎</button>
            <button type="button" className="icon-btn" aria-label={`${f.name} 폴더 지우기`} title="폴더 지우기" onClick={() => setConfirmF(f.id)}>×</button>
          </span>
          {confirmF === f.id && (
            <span className="row confirm-inline" role="group" aria-label="폴더 지우기 확인">
              <span className="muted">안의 노트는 위 폴더로 옮깁니다.</span>
              <button type="button" className="danger" onClick={() => fAct(async () => { setConfirmF(undefined); if (folder === f.id) setFolder(f.parent); await deleteFolder(db, f.id) })}>폴더 지우기</button>
              <button type="button" className="link" onClick={() => setConfirmF(undefined)}>취소</button>
            </span>
          )}
        </li>,
        ...(open ? [...folderRows(x.folders, depth + 1), ...x.notes.map((n) => noteRow(n, depth + 1))] : []),
      ]
    })

  return (
    <section className="stack notes-page">
      <PageHead title="노트함" summary={`노트 ${notes.length}개`}>
        <button type="button" className="primary" onClick={async () => navigate(`/notes?id=${(await createNote(db, undefined, undefined, folder)).id}`)}>
          + 새 노트
        </button>
        {current && <ExportMenu items={[{ format: 'hwpx', run: () => exportAs('hwpx') }, { format: 'xlsx', run: () => exportAs('xlsx') }, { format: 'pdf', run: () => exportPdf(`${current.title || '노트'}.pdf`) }]} />}
      </PageHead>
      <div className="notes-layout">
        <div className="notes-list stack">
          <input type="search" aria-label="노트 찾기" placeholder="제목·내용 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row notes-folder-bar">
            <button type="button" className="link" onClick={() => fAct(async () => { const nf = await addFolder(db, '새 폴더', folder); if (folder) toggleF(folder, true); setEdit({ id: nf.id, name: nf.name }) })}>
              + 폴더
            </button>
            {folder && <span className="muted">{`새 노트·폴더는 '${folders.find((f) => f.id === folder)?.name ?? ''}' 안에`}</span>}
          </div>
          {fmsg && <p className="error" role="alert">{fmsg}</p>}
          <ul className="plain" aria-label="노트 목록">
            {q.trim() ? (
              shown.map((n) => noteRow(n))
            ) : (
              <>
                {folderRows(tree.folders, 0)}
                {(dragNote || dragFolder) && (
                  <li className={`folder-drop-top${dropOn === '__top' ? ' drop' : ''}`} {...dropTo(null)}>
                    맨 위로 옮기기
                  </li>
                )}
                {tree.notes.map((n) => noteRow(n))}
              </>
            )}
            {notes.length === 0 && <li className="muted">노트가 없습니다.</li>}
            {notes.length > 0 && q.trim() && shown.length === 0 && <li className="muted">찾는 노트가 없습니다.</li>}
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
              {folders.length > 0 && (
                <label className="inline note-folder-pick">
                  폴더
                  <select aria-label="노트 폴더" value={notes.find((n) => n.id === current.id)?.folder_id && folders.some((f) => f.id === notes.find((n) => n.id === current.id)?.folder_id) ? notes.find((n) => n.id === current.id)!.folder_id! : ''} onChange={(e) => fAct(() => moveNote(db, current.id, e.target.value || null))}>
                    <option value="">맨 위(폴더 없음)</option>
                    {folderOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </label>
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
