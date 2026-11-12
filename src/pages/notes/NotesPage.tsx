import { useEffect, useMemo, useRef, useState } from 'react'
import { startPointerDrag } from '../../lib/ui/pointerDrag'
import Icon from '../../components/Icon'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDb, useFs } from '../../app/context'
import type { NoteRec, TodoRec } from '../../lib/db/types'
import { createNote, deleteNote, listNotes, noteText, setPinned } from '../../lib/notes/notes'
import { addFolder, deleteFolder, folderTree, listFolders, moveFolder, moveNote, renameFolder, reorderNotes, type FolderNode } from '../../lib/notes/noteFolders'
import type { NoteFolder } from '../../lib/db/types'
import { setTodoDone, todosLinkingNote } from '../../lib/todos/todos'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { exportPdf } from '../../lib/export/pdf'
import { toYmd } from '../../lib/schoolDays'
import { useLive } from '../../lib/ui/useLive'
import ExportMenu from '../../components/ExportMenu'
import { buildNoteHwpx } from '../../lib/docs/note-doc'
import PageHead from '../../components/PageHead'
import NoteEditor from './NoteEditor'
import NoticeTag, { shownTitle } from './NoticeTag'
import { readFile } from '../../lib/notes/notes'
import { unlinkNoticeNote } from '../../lib/notices/noteSync'

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
  /** 끄는 것과 놓일 자리: 폴더 안(into) · 노트 앞뒤 줄(line) · 맨 아래(end) */
  const [drag, setDrag] = useState<{ kind: 'note' | 'folder'; id: string }>()
  const [drop, setDrop] = useState<{ kind: 'into' | 'line' | 'end'; id?: string; after?: boolean }>()
  const listRef = useRef<HTMLUListElement>(null)
  const tree = useMemo(() => folderTree(folders, notes), [folders, notes])
  const fAct = async (fn: () => Promise<unknown>) => {
    try {
      setFmsg(undefined)
      await fn()
    } catch (e) {
      setFmsg(e instanceof Error ? e.message : String(e))
    }
  }
  /** 폴더(null = 맨 위) 안 노트 id들(보이는 순서) */
  const notesIn = (fid: string | null): string[] => {
    if (!fid) return tree.notes.map((n) => n.id)
    const find = (nodes: FolderNode[]): FolderNode | undefined => nodes.reduce<FolderNode | undefined>((hit, x) => hit ?? (x.folder.id === fid ? x : find(x.folders)), undefined)
    return find(tree.folders)?.notes.map((n) => n.id) ?? []
  }
  /** 포인터 아래 줄로 놓일 자리 정하기 */
  const dropAt = (x: number, y: number, kind: 'note' | 'folder', id: string) => {
    const li = document.elementFromPoint(x, y)?.closest<HTMLElement>('li[data-kind]')
    if (!li || !listRef.current?.contains(li)) return listRef.current?.contains(document.elementFromPoint(x, y)) ? { kind: 'end' as const } : undefined
    if (li.dataset.id === id) return undefined
    if (li.dataset.kind === 'folder') return { kind: 'into' as const, id: li.dataset.id }
    if (kind === 'folder') return { kind: 'into' as const, id: li.dataset.parent || undefined }
    const r = li.getBoundingClientRect()
    return { kind: 'line' as const, id: li.dataset.id, after: y > r.top + r.height / 2 }
  }
  function beginDrag(e: React.PointerEvent, kind: 'note' | 'folder', id: string) {
    // 폴더 이름 단추·노트 링크에서도 끌 수 있다(5px 넘게 움직여야 끌기). 다른 단추·입력 칸은 그대로
    const t = e.target as Element
    if (t.closest('input, select') || (t.closest('button') && !t.closest('.folder-name'))) return
    let last: typeof drop
    startPointerDrag(e, {
      onStart: () => setDrag({ kind, id }),
      onMove: (x, y) => setDrop((last = dropAt(x, y, kind, id))),
      onCancel: () => (setDrag(undefined), setDrop(undefined)),
      onDrop: () => {
        setDrag(undefined)
        setDrop(undefined)
        const d = last
        if (!d) return
        if (kind === 'folder') {
          const to = d.kind === 'into' ? d.id ?? null : null
          if (to !== id) fAct(() => moveFolder(db, id, to))
          if (to) toggleF(to, true)
          return
        }
        if (d.kind === 'into' && d.id) {
          toggleF(d.id, true)
          return void fAct(() => reorderNotes(db, d.id!, [...notesIn(d.id!).filter((x) => x !== id), id]))
        }
        if (d.kind === 'end') return void fAct(() => reorderNotes(db, null, [...notesIn(null).filter((x) => x !== id), id]))
        const target = notes.find((n) => n.id === d.id)
        if (!target) return
        const fid = target.folder_id && folders.some((f) => f.id === target.folder_id) ? target.folder_id : null
        const ids = notesIn(fid).filter((x) => x !== id)
        const at = ids.indexOf(target.id) + (d.after ? 1 : 0)
        fAct(() => reorderNotes(db, fid, [...ids.slice(0, at), id, ...ids.slice(at)]))
      },
    })
  }
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
      // 한글: 글자 서식·들여쓰기·목록·체크·학생 표를 한글 문단 그대로
      const names = new Map<string, string>()
      for (const b of n.blocks) if (b.type === 'file' && b.file_id) names.set(b.file_id, (await db.note_files.get(b.file_id))?.name ?? '파일')
      const images = new Map<string, Uint8Array>()
      for (const b of n.blocks)
        if (b.type === 'image' && b.file_id)
          try {
            images.set(b.file_id, (await readFile(db, b.file_id)).bytes)
          } catch {
            /* 없는 그림은 [그림]으로 */
          }
      fs.downloadFile(name, await buildNoteHwpx(n, names, undefined, images))
    }
  }

  const lineCls = (id: string) => (drop?.kind === 'line' && drop.id === id ? (drop.after ? ' drop-after' : ' drop-before') : '')
  const noteRow = (n: NoteRec, depth = 0, parent: string | null = null) => (
    <li key={n.id} data-kind="note" data-id={n.id} data-parent={parent ?? ''} className={`note-item tree-row${n.id === id ? ' on' : ''}${drag?.id === n.id ? ' dragging' : ''}${lineCls(n.id)}`} style={{ paddingLeft: 4 + depth * 16 }} onPointerDown={(e) => !q.trim() && beginDrag(e, 'note', n.id)}>
      <span className="tree-twisty" aria-hidden="true" />
      <span className="tree-ico" aria-hidden="true"><Icon name="doc" size={15} /></span>
      <NoticeTag note={n} />
      <Link to={`/notes?id=${n.id}`} draggable={false} className="tree-title">{shownTitle(n)}</Link>
      {n.blocks.some((b) => b.type === 'file') && <span title="첨부 있음" aria-label="첨부 있음">📎</span>}
      {n.pinned && <span className="tree-pinned" aria-hidden="true"><Icon name="pin" size={12} /></span>}
      {/* 마우스를 올리면 오른쪽이 흐려지며 도구가 뜬다(제목이 …로 잘리지 않게 자리를 차지하지 않음) */}
      <span className="hover-tools">
        <button type="button" className={`icon-btn${n.pinned ? ' on' : ''}`} aria-label={`${n.title} 고정`} aria-pressed={n.pinned} onClick={() => setPinned(db, n.id, !n.pinned)}>
          <Icon name="pin" size={14} />
        </button>
        {n.notice_date && (
          <button type="button" className="icon-btn" aria-label={`${n.title} 전달사항에서 빼기`} title="전달사항 연결 제거(노트·전달사항은 남음)" onClick={() => void unlinkNoticeNote(db, n.id)}>
            <Icon name="megaphone" size={14} />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label={`${n.title} 지우기`} onClick={() => setConfirmDel(n.id)}><Icon name="trash" size={14} /></button>
      </span>
      {confirmDel === n.id && (
        <span className="row confirm-inline confirm-even" role="group" aria-label="노트 지우기 확인">
          <span>지울까요?</span>
          <button type="button" className="danger" onClick={async () => { setConfirmDel(undefined); await deleteNote(db, n.id); if (n.id === id) navigate('/notes') }}>정말 지우기</button>
          <button type="button" onClick={() => setConfirmDel(undefined)}>취소</button>
        </span>
      )}
    </li>
  )
  const folderRows = (nodes: FolderNode[], depth: number): React.ReactNode[] =>
    nodes.flatMap((x) => {
      const f = x.folder
      const open = openF.has(f.id)
      return [
        <li key={`f-${f.id}`} data-kind="folder" data-id={f.id} data-parent={f.parent ?? ''} className={`folder-item tree-row${folder === f.id ? ' on' : ''}${drop?.kind === 'into' && drop.id === f.id ? ' drop' : ''}${drag?.id === f.id ? ' dragging' : ''}`} style={{ paddingLeft: 4 + depth * 16 }} onPointerDown={(e) => edit?.id !== f.id && beginDrag(e, 'folder', f.id)}>
          <button type="button" className="icon-btn folder-twisty tree-twisty" aria-label={`${f.name} ${open ? '접기' : '펴기'}`} aria-expanded={open} onClick={() => toggleF(f.id)}>{open ? '▾' : '▸'}</button>
          <span className="tree-ico" aria-hidden="true"><Icon name="folder" size={15} /></span>
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
              {f.name} <span className="muted">{x.count}</span>
            </button>
          )}
          <span className="folder-tools">
            <button type="button" className="icon-btn" aria-label={`${f.name}에 새 노트`} title="이 폴더에 새 노트" onClick={() => fAct(async () => { const nn = await createNote(db, undefined, undefined, f.id); toggleF(f.id, true); navigate(`/notes?id=${nn.id}`) })}><Icon name="plus" size={14} /></button>
            <button type="button" className="icon-btn" aria-label={`${f.name} 이름 바꾸기`} title="이름 바꾸기" onClick={() => setEdit({ id: f.id, name: f.name })}><Icon name="pencil" size={14} /></button>
            <button type="button" className="icon-btn" aria-label={`${f.name} 폴더 지우기`} title="폴더 지우기" onClick={() => setConfirmF(f.id)}><Icon name="trash" size={14} /></button>
          </span>
          {confirmF === f.id && (
            <span className="row confirm-inline" role="group" aria-label="폴더 지우기 확인">
              <span className="muted">안의 노트는 위 폴더로 옮깁니다.</span>
              <button type="button" className="danger" onClick={() => fAct(async () => { setConfirmF(undefined); if (folder === f.id) setFolder(f.parent); await deleteFolder(db, f.id) })}>폴더 지우기</button>
              <button type="button" className="link" onClick={() => setConfirmF(undefined)}>취소</button>
            </span>
          )}
        </li>,
        ...(open ? [...folderRows(x.folders, depth + 1), ...x.notes.map((n) => noteRow(n, depth + 1, f.id))] : []),
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
          <ul className={`plain notes-tree${drop?.kind === 'end' ? ' drop-end' : ''}`} aria-label="노트 목록" ref={listRef}>
            {q.trim() ? (
              shown.map((n) => noteRow(n))
            ) : (
              <>
                {folderRows(tree.folders, 0)}
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
