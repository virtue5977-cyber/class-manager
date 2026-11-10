import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useDb, useFs } from '../../app/context'
import type { NoteBlock, NoteBlockType, NoteRec } from '../../lib/db/types'
import { attachFile, MAX_FILE, newBlockId, readFile, saveNoteContent } from '../../lib/notes/notes'
import { filterSlash, indentBlock, mergeUp, moveBlock, outlineMarks, setType, splitBlock } from '../../lib/notes/blocks'
import { getFolderBridge, NEED_EXE } from '../../lib/notes/folders'
import { addNotice } from '../../lib/notices/notices'

/** 파일 내용 읽기(arrayBuffer 없는 환경은 FileReader로) */
function fileBytes(f: File): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer().then((b) => new Uint8Array(b))
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => rej(r.error)
    r.readAsArrayBuffer(f)
  })
}
const fmtSize = (n: number) => (n < 1024 ? `${n}B` : n < 1048576 ? `${(n / 1024).toFixed(0)}KB` : `${(n / 1048576).toFixed(1)}MB`)

/** 노트 편집: 제목 + 블록(빈 블록에서 / → 블록 메뉴). 입력이 멈추고 0.5초 뒤 저장. */
export default function NoteEditor({ note, today }: { note: NoteRec; today: string }) {
  const db = useDb()
  const fs = useFs()
  const [title, setTitle] = useState(note.title)
  const [blocks, setBlocks] = useState<NoteBlock[]>(note.blocks.length ? note.blocks : [{ id: newBlockId(), type: 'p', text: '' }])
  const [slashSel, setSlashSel] = useState(0)
  const [msg, setMsg] = useState<string>()
  const [menuFor, setMenuFor] = useState<string>()
  const [dragId, setDragId] = useState<string>()
  const [fileInfo, setFileInfo] = useState<Record<string, { name: string; size: number }>>({})
  const [folderList, setFolderList] = useState<Record<string, { name: string; dir: boolean }[]>>({})
  const refs = useRef(new Map<string, HTMLTextAreaElement>())
  const focusNext = useRef<{ id: string; caret: number } | null>(null)
  const latest = useRef({ title, blocks })
  latest.current = { title, blocks }

  // 입력이 멈추면 저장(바뀐 것이 있을 때만). 화면을 떠날 때도 저장.
  useEffect(() => {
    const t = setTimeout(() => {
      if (title !== note.title || JSON.stringify(blocks) !== JSON.stringify(note.blocks)) saveNoteContent(db, note.id, { title, blocks })
    }, 500)
    return () => clearTimeout(t)
  }, [db, note, title, blocks])
  useEffect(
    () => () => {
      const l = latest.current
      if (l.title !== note.title || JSON.stringify(l.blocks) !== JSON.stringify(note.blocks)) saveNoteContent(db, note.id, l)
    },
    [db, note],
  )
  useEffect(() => {
    const f = focusNext.current
    if (!f) return
    const el = refs.current.get(f.id)
    if (el) {
      el.focus()
      el.setSelectionRange(f.caret, f.caret)
    }
    focusNext.current = null
  })
  useEffect(() => {
    ;(async () => {
      const ids = blocks.filter((b) => b.type === 'file' && b.file_id && !fileInfo[b.file_id]).map((b) => b.file_id!)
      if (!ids.length) return
      const add: Record<string, { name: string; size: number }> = {}
      for (const id of ids) {
        const f = await db.note_files.get(id)
        if (f) add[id] = { name: f.name, size: f.size }
      }
      setFileInfo((m) => ({ ...m, ...add }))
    })()
  }, [db, blocks, fileInfo])

  const update = (id: string, patch: Partial<NoteBlock>) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  const slashOf = (b: NoteBlock) => (/^\/(\S*)$/.exec(b.text ?? '')?.[1] ?? null)

  async function addFiles(files: File[], afterId?: string) {
    setMsg(undefined)
    for (const f of files) {
      if (f.size > MAX_FILE) {
        setMsg('50MB까지 붙일 수 있습니다.')
        continue
      }
      const rec = await attachFile(db, note.id, { name: f.name, mime: f.type, bytes: await fileBytes(f) })
      setFileInfo((m) => ({ ...m, [rec.id]: { name: rec.name, size: rec.size } }))
      const nb: NoteBlock = { id: newBlockId(), type: 'file', file_id: rec.id }
      setBlocks((bs) => {
        const i = afterId ? bs.findIndex((b) => b.id === afterId) : bs.length - 1
        const base = afterId && !(bs[i]?.text ?? '').trim() && bs[i]?.type !== 'file' ? bs.filter((b) => b.id !== afterId) : bs
        const j = afterId ? Math.min(i, base.length) : base.length
        return [...base.slice(0, j), nb, ...base.slice(j)]
      })
    }
  }

  async function chooseSlash(b: NoteBlock, type: NoteBlockType) {
    setSlashSel(0)
    if (type === 'file') {
      const f = await fs.pickFileToRead()
      update(b.id, { text: '' })
      if (f) {
        if (f.bytes.length > MAX_FILE) return setMsg('50MB까지 붙일 수 있습니다.')
        const rec = await attachFile(db, note.id, { name: f.name, mime: '', bytes: f.bytes })
        setFileInfo((m) => ({ ...m, [rec.id]: { name: rec.name, size: rec.size } }))
        setBlocks((bs) => bs.map((x) => (x.id === b.id ? { id: x.id, type: 'file', file_id: rec.id } : x)))
      }
      return
    }
    if (type === 'folder') {
      const bridge = getFolderBridge()
      update(b.id, { text: '' })
      if (!bridge) return setMsg(NEED_EXE)
      const r = await bridge.pick()
      if (r) setBlocks((bs) => bs.map((x) => (x.id === b.id ? { id: x.id, type: 'folder', path: r.path } : x)))
      return
    }
    if (type === 'divider') {
      setBlocks((bs) => {
        const i = bs.findIndex((x) => x.id === b.id)
        const nb: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
        focusNext.current = { id: nb.id, caret: 0 }
        return [...bs.slice(0, i), { id: b.id, type: 'divider' }, nb, ...bs.slice(i + 1)]
      })
      return
    }
    setBlocks((bs) => setType(bs, b.id, type).map((x) => (x.id === b.id ? { ...x, text: '' } : x)))
    focusNext.current = { id: b.id, caret: 0 }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>, b: NoteBlock) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    const q = slashOf(b)
    const items = q !== null ? filterSlash(q) : []
    if (items.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSel((i) => (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        chooseSlash(b, items[Math.min(slashSel, items.length - 1)].type)
        return
      }
      if (e.key === 'Escape') {
        update(b.id, { text: (b.text ?? '') + ' ' })
        return
      }
    }
    const el = e.currentTarget
    if (e.key === 'Tab' && b.type !== 'h1' && b.type !== 'h2') {
      e.preventDefault()
      setBlocks((bs) => indentBlock(bs, b.id, e.shiftKey ? -1 : 1))
      focusNext.current = { id: b.id, caret: el.selectionStart }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const r = splitBlock(blocks, b.id, el.selectionStart)
      setBlocks(r.blocks)
      focusNext.current = { id: r.focusId, caret: 0 }
    } else if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault()
      const r = mergeUp(blocks, b.id)
      setBlocks(r.blocks)
      focusNext.current = { id: r.focusId, caret: r.caret }
    }
  }

  async function blockAction(b: NoteBlock, act: 'notice' | 'copy' | 'delete') {
    setMenuFor(undefined)
    if (act === 'notice') {
      if (!(b.text ?? '').trim()) return setMsg('보낼 글이 없습니다.')
      await addNotice(db, { text: b.text!, start_date: today })
      setMsg('오늘 전달사항으로 보냈습니다.')
    } else if (act === 'copy') {
      setBlocks((bs) => {
        const i = bs.findIndex((x) => x.id === b.id)
        return [...bs.slice(0, i + 1), { ...b, id: newBlockId() }, ...bs.slice(i + 1)]
      })
    } else setBlocks((bs) => (bs.length > 1 ? bs.filter((x) => x.id !== b.id) : [{ id: newBlockId(), type: 'p', text: '' }]))
  }

  const onDrop = (e: DragEvent) => {
    if (dragId) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    e.preventDefault()
    addFiles(files)
  }

  const marks = outlineMarks(blocks)
  return (
    <section className="note-editor" aria-label="노트 편집" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <input className="note-title" aria-label="노트 제목" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
      {msg && <p className="notice" role="status">{msg}</p>}
      <div className="note-blocks">
        {blocks.map((b, i) => {
          const lv = b.indent ?? 0
          const q = slashOf(b)
          const items = q !== null ? filterSlash(q) : []
          return (
            <div
              key={b.id}
              className={`nb nb-${b.type} nb-l${lv}${dragId === b.id ? ' dragging' : ''}`}
              style={lv ? { paddingLeft: `${lv * 26}px` } : undefined}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={(e) => {
                if (!dragId) return
                e.preventDefault()
                e.stopPropagation()
                setBlocks((bs) => moveBlock(bs, dragId, i))
                setDragId(undefined)
              }}
            >
              <button type="button" className="nb-handle" aria-label="블록 메뉴" draggable onDragStart={() => setDragId(b.id)} onDragEnd={() => setDragId(undefined)} onClick={() => setMenuFor(menuFor === b.id ? undefined : b.id)}>
                ⋮⋮
              </button>
              {menuFor === b.id && (
                <div className="menu-list nb-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => blockAction(b, 'notice')}>전달사항으로 보내기</button>
                  <button type="button" role="menuitem" onClick={() => blockAction(b, 'copy')}>복사</button>
                  <button type="button" role="menuitem" onClick={() => blockAction(b, 'delete')}>지우기</button>
                </div>
              )}
              {b.type === 'divider' ? (
                <hr />
              ) : b.type === 'file' ? (
                <button type="button" className="nb-file" onClick={async () => { const f = await readFile(db, b.file_id!); fs.downloadFile(f.name, f.bytes) }}>
                  {`📎 ${fileInfo[b.file_id!]?.name ?? '첨부 파일'} (${fmtSize(fileInfo[b.file_id!]?.size ?? 0)})`}
                </button>
              ) : b.type === 'folder' ? (
                <div className="nb-folder">
                  <button type="button" className="link" onClick={async () => { const br = getFolderBridge(); if (!br) return setMsg(NEED_EXE); try { await br.open(b.path!) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } }}>
                    {`📁 ${b.path}`}
                  </button>
                  <button type="button" className="link muted" onClick={async () => { const br = getFolderBridge(); if (!br) return setMsg(NEED_EXE); try { setFolderList((m) => ({ ...m, [b.id]: [] })); const l = await br.list(b.path!); setFolderList((m) => ({ ...m, [b.id]: l })) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } }}>
                    안의 파일 보기
                  </button>
                  {folderList[b.id] && (
                    <ul className="plain nb-folder-list">
                      {folderList[b.id].map((x) => <li key={x.name}>{`${x.dir ? '📁' : '·'} ${x.name}`}</li>)}
                    </ul>
                  )}
                </div>
              ) : (
                <>
                  {b.type === 'check' && <input type="checkbox" aria-label="체크" checked={!!b.checked} onChange={(e) => update(b.id, { checked: e.target.checked })} />}
                  {(b.type === 'bullet' || b.type === 'number') && <span className={`nb-mark nb-mark-${b.type}`}>{marks[i]}</span>}
                  <textarea
                    ref={(el) => (el ? refs.current.set(b.id, el) : refs.current.delete(b.id))}
                    aria-label={`블록 ${i + 1}`}
                    rows={1}
                    value={b.text ?? ''}
                    placeholder={i === blocks.length - 1 ? "글을 쓰거나 '/'로 블록 고르기" : ''}
                    onChange={(e) => {
                      update(b.id, { text: e.target.value })
                      setSlashSel(0)
                      e.target.style.height = 'auto'
                      e.target.style.height = `${e.target.scrollHeight}px`
                    }}
                    onKeyDown={(e) => onKey(e, b)}
                  />
                  {items.length > 0 && (
                    <ul className="suggest nb-slash" role="listbox" aria-label="블록 고르기">
                      {items.map((it, k) => (
                        <li key={it.type} role="option" aria-selected={k === slashSel} className={k === slashSel ? 'on' : undefined} onMouseDown={(e) => (e.preventDefault(), chooseSlash(b, it.type))}>
                          {it.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      <p className="muted nb-hint">파일을 끌어다 놓으면 붙습니다(50MB까지).</p>
    </section>
  )
}
