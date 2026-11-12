import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useDb, useFs } from '../../app/context'
import type { NoteBlock, NoteBlockType, NoteRec } from '../../lib/db/types'
import { attachFile, MAX_FILE, newBlockId, readFile, saveNoteContent } from '../../lib/notes/notes'
import { filterSlash, indentBlock, markdownPrefix, mergeUp, moveBlock, noteShortcut, outlineMarks, rosterBlock, setType, splitBlock } from '../../lib/notes/blocks'
import { caretNav, placeCaret } from '../../lib/ui/caretNav'
import RichLine, { type LineHandle, type LineValue } from './RichLine'
import FormatBar from './FormatBar'
import { applyStyle, styleAt } from '../../lib/notes/marks'
import { getSel } from '../../lib/notes/richDom'
import { getCurrentClassId, listStudents } from '../../lib/roster/roster'
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
  // 블록 메뉴: Esc(손잡이로 초점 돌림)·바깥 누르기로 닫기
  useEffect(() => {
    if (!menuFor) return undefined
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      document.querySelector<HTMLButtonElement>(`[data-handle="${menuFor}"]`)?.focus()
      setMenuFor(undefined)
    }
    const down = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('.nb-menu') || t?.closest(`[data-handle="${menuFor}"]`)) return
      setMenuFor(undefined)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', down)
    }
  }, [menuFor])
  /** 전달사항으로 보낼 블록(또는 'all' = 노트 전체)과 기간 */
  const [sendFor, setSendFor] = useState<string>()
  const [range, setRange] = useState({ start: today, end: today })
  const [dragId, setDragId] = useState<string>()
  const [fileInfo, setFileInfo] = useState<Record<string, { name: string; size: number }>>({})
  const [folderList, setFolderList] = useState<Record<string, { name: string; dir: boolean }[]>>({})
  const refs = useRef(new Map<string, LineHandle>())
  /** 글자를 고른 줄(서식 막대) */
  const [picked, setPicked] = useState<{ id: string; start: number; end: number; top: number; left: number }>()
  const focusNext = useRef<{ id: string; caret: number } | null>(null)
  // 되돌리기(Ctrl+Z)·다시(Ctrl+Y, Ctrl+Shift+Z): 0.7초 넘게 쉬거나 줄 수가 바뀌면 한 단계
  const hist = useRef({ past: [] as NoteBlock[][], future: [] as NoteBlock[][], last: 0, prev: blocks, skip: false })
  useEffect(() => {
    const h = hist.current
    if (h.prev === blocks) return
    if (h.skip) {
      h.skip = false
      h.prev = blocks
      return
    }
    const now = Date.now()
    if (now - h.last > 700 || h.prev.length !== blocks.length) {
      h.past.push(h.prev)
      if (h.past.length > 100) h.past.shift()
    }
    h.last = now
    h.future = []
    h.prev = blocks
  }, [blocks])
  function stepHistory(dir: -1 | 1, focusId: string) {
    const h = hist.current
    const from = dir === -1 ? h.past : h.future
    const to = dir === -1 ? h.future : h.past
    const next = from.pop()
    if (!next) return
    to.push(blocks)
    h.skip = true
    h.last = 0
    setBlocks(next)
    const id = next.some((x) => x.id === focusId) ? focusId : next[next.length - 1]?.id
    if (id) focusNext.current = { id, caret: (next.find((x) => x.id === id)?.text ?? '').length }
  }
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
  const [slashOff, setSlashOff] = useState<string>()
  /** 블록 글이 '/…'(12자까지, 띄어쓰기 포함)이면 블록 메뉴 거르기 글. Esc로 닫은 블록은 '/'를 지울 때까지 닫힘. */
  const slashOf = (b: NoteBlock) => (slashOff === b.id ? null : (/^\/([^\n]{0,12})$/.exec(b.text ?? '')?.[1] ?? null))

  async function addFiles(files: File[], afterId?: string) {
    setMsg(undefined)
    for (const f of files) {
      if (f.size > MAX_FILE) {
        setMsg('50MB까지 붙일 수 있습니다.')
        continue
      }
      let rec
      try {
        rec = await attachFile(db, note.id, { name: f.name, mime: f.type, bytes: await fileBytes(f) })
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e))
        break
      }
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

  /** 그 블록 자리에 지금 학급 학생 체크 표를 넣고, 아래에 빈 글 블록 */
  async function insertRoster(b: NoteBlock) {
    const cid = await getCurrentClassId(db)
    const studs = cid ? await listStudents(db, cid, { includeInactive: false }) : []
    if (!studs.length) {
      update(b.id, { text: '' })
      return setMsg('학급 명단이 없습니다. 학급 > 명단에서 학생을 먼저 넣으세요.')
    }
    const t = rosterBlock(studs)
    const nb: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
    setBlocks((bs) => {
      const i = bs.findIndex((x) => x.id === b.id)
      const keep = (b.text ?? '').replace(/^[@/]명렬표\s*$/, '').trim() ? [{ ...b }] : []
      return [...bs.slice(0, i), ...keep, t, nb, ...bs.slice(i + 1)]
    })
    focusNext.current = { id: nb.id, caret: 0 }
  }

  async function chooseSlash(b: NoteBlock, type: NoteBlockType) {
    setSlashSel(0)
    if (type === 'file') {
      const f = await fs.pickFileToRead('', { maxBytes: MAX_FILE })
      update(b.id, { text: '' })
      if (f) {
        if (f.tooBig || f.bytes.length > MAX_FILE) return setMsg('50MB까지 붙일 수 있습니다.')
        let rec
        try {
          rec = await attachFile(db, note.id, { name: f.name, mime: '', bytes: f.bytes })
        } catch (e) {
          return setMsg(e instanceof Error ? e.message : String(e))
        }
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
    if (type === 'roster') return insertRoster(b)
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

  /** 줄 글이 바뀜: 문단 맨 앞에 '# ', '- ', '1. ', '[] ' 등을 치면 그 블록으로(방금 친 글자가 띄어쓰기이고 커서 앞이 바꾸기 글자뿐일 때만) */
  function onLineChange(b: NoteBlock, v: LineValue, at: number) {
    const head = markdownPrefix(v.text.slice(0, at))
    const md = b.type === 'p' && v.text.length === (b.text ?? '').length + 1 && v.text[at - 1] === ' ' && head && head.rest === '' ? { type: head.type, rest: v.text.slice(at) } : null
    if (md) {
      setBlocks((bs) => setType(bs, b.id, md.type).map((x) => (x.id === b.id ? { ...x, text: md.rest, marks: undefined, links: undefined } : x)))
      focusNext.current = { id: b.id, caret: 0 }
      return
    }
    update(b.id, { text: v.text, marks: v.marks?.length ? v.marks : undefined, links: v.links?.length ? v.links : undefined })
    setSlashSel(0)
    if (slashOff === b.id && !v.text.startsWith('/')) setSlashOff(undefined)
  }

  /** 글자를 고르면 서식 막대를 띄운다 */
  const trackSel = useCallback(() => {
    for (const [id, h] of refs.current) {
      const d = h.el
      if (!d || d.ownerDocument.activeElement !== d) continue
      const sel = getSel(d)
      if (!sel || sel.start === sel.end) return setPicked(undefined)
      const r = d.ownerDocument.getSelection()?.getRangeAt(0)
      const rect = r && typeof r.getBoundingClientRect === 'function' ? r.getBoundingClientRect() : null
      const box = d.getBoundingClientRect?.()
      return setPicked({ id, start: Math.min(sel.start, sel.end), end: Math.max(sel.start, sel.end), top: rect?.top || box?.top || 0, left: rect?.left || box?.left || 0 })
    }
    setPicked(undefined)
  }, [])
  useEffect(() => {
    document.addEventListener('selectionchange', trackSel)
    return () => document.removeEventListener('selectionchange', trackSel)
  }, [trackSel])
  function applyFormat(key: Parameters<typeof applyStyle>[4], value?: string) {
    if (!picked) return
    const b = blocks.find((x) => x.id === picked.id)
    if (!b) return
    const marks = applyStyle(b.marks, (b.text ?? '').length, picked.start, picked.end, key, value)
    update(b.id, { marks: marks.length ? marks : undefined })
    requestAnimationFrame(() => refs.current.get(b.id)?.setSelectionRange(picked.start, picked.end))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>, b: NoteBlock, el: LineHandle) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY' || /^[zy]$/i.test(e.key))) {
      e.preventDefault()
      const redo = e.code === 'KeyY' || e.key.toLowerCase() === 'y' || e.shiftKey
      return stepHistory(redo ? 1 : -1, b.id)
    }
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
        setSlashOff(b.id)
        return
      }
    }
    // 방향키: 첫·마지막 줄(맨 앞·끝)에서 옆 글 블록으로(구분선·파일·표는 건너뜀)
    // / 메뉴가 열려 있으면 메뉴가 먼저(←→로도 블록을 떠나지 않는다)
    const mv = items.length ? null : caretNav({ ...e, isComposing: e.nativeEvent.isComposing }, el)
    if (mv && ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || el.atEdge(mv.dir))) {
      const i = blocks.findIndex((x) => x.id === b.id)
      const dir = mv.dir
      for (let j = i + dir; j >= 0 && j < blocks.length; j += dir) {
        const to = refs.current.get(blocks[j].id)
        if (!to) continue
        e.preventDefault()
        to.focus()
        const c = placeCaret(to.value, mv)
        to.setSelectionRange(c, c)
        return
      }
    }
    // 노트 안 단축키(이 칸에 초점이 있을 때만): Ctrl+1 문단 2 제목1 3 제목2 4 글머리 5 번호 6 체크(예전 Ctrl+Shift·Alt 숫자, Ctrl+Alt+T 표)
    {
      const type = noteShortcut(e)
      if (type) {
        e.preventDefault()
        e.stopPropagation()
        if (type === 'roster') return void insertRoster(b)
        const caret = el.selectionStart
        setBlocks((bs) => setType(bs, b.id, type))
        focusNext.current = { id: b.id, caret }
        return
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && b.type === 'check') {
      e.preventDefault()
      update(b.id, { checked: !b.checked })
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && /^[@/]명렬표$/.test((b.text ?? '').trim())) {
      e.preventDefault()
      return void insertRoster(b)
    }
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
      setRange({ start: today, end: today })
      setSendFor(b.id)
    } else if (act === 'copy') {
      setBlocks((bs) => {
        const i = bs.findIndex((x) => x.id === b.id)
        return [...bs.slice(0, i + 1), { ...b, id: newBlockId() }, ...bs.slice(i + 1)]
      })
    } else setBlocks((bs) => (bs.length > 1 ? bs.filter((x) => x.id !== b.id) : [{ id: newBlockId(), type: 'p', text: '' }]))
  }

  /** 기간을 정해 보내기: 블록 하나 또는 노트 전체(글이 있는 블록마다 한 항목) */
  async function sendNotices() {
    const targets = sendFor === 'all' ? blocks.filter((x) => (x.text ?? '').trim() && x.type !== 'h1' && x.type !== 'h2') : blocks.filter((x) => x.id === sendFor)
    try {
      for (const x of targets) await addNotice(db, { text: x.text!.trim(), start_date: range.start, end_date: range.end })
      setMsg(`전달사항 ${targets.length}개를 보냈습니다.`)
      setSendFor(undefined)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
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
      <div className="row note-tools">
        <button type="button" className="link" onClick={() => { setRange({ start: today, end: today }); setSendFor('all') }}>노트 전체를 전달사항으로</button>
      </div>
      {sendFor && (
        <div className="row card send-range" role="group" aria-label="전달사항 기간">
          <span>{sendFor === 'all' ? '노트 전체(글 블록마다 한 항목)' : '이 블록'}을 전달사항으로:</span>
          <input type="date" aria-label="시작" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
          ~
          <input type="date" aria-label="끝" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
          <button type="button" className="primary" onClick={sendNotices}>보내기</button>
          <button type="button" className="link" onClick={() => setSendFor(undefined)}>취소</button>
        </div>
      )}
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
              <button type="button" className="nb-handle" data-handle={b.id} aria-label="블록 메뉴" aria-haspopup="menu" aria-expanded={menuFor === b.id} draggable onDragStart={() => setDragId(b.id)} onDragEnd={() => setDragId(undefined)} onClick={() => setMenuFor(menuFor === b.id ? undefined : b.id)}>
                ⋮⋮
              </button>
              {menuFor === b.id && (
                <div className="menu-list nb-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => blockAction(b, 'notice')}>전달사항으로 보내기</button>
                  <button type="button" role="menuitem" onClick={() => blockAction(b, 'copy')}>복사</button>
                  <button type="button" role="menuitem" onClick={() => blockAction(b, 'delete')}>지우기</button>
                </div>
              )}
              {b.type === 'roster' ? (
                <RosterTable b={b} onChange={(patch) => update(b.id, patch)} />
              ) : b.type === 'divider' ? (
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
                  {(b.type === 'check' || b.type === 'bullet' || b.type === 'number') && (
                    <span className={`nb-lead nb-lead-${b.type}`}>
                      {b.type === 'check' ? <input type="checkbox" aria-label="체크" checked={!!b.checked} onChange={(e) => update(b.id, { checked: e.target.checked })} /> : <span className={`nb-mark nb-mark-${b.type}`}>{marks[i]}</span>}
                    </span>
                  )}
                  <RichLine
                    ref={(h) => (h ? refs.current.set(b.id, h) : refs.current.delete(b.id))}
                    label={`블록 ${i + 1}`}
                    text={b.text ?? ''}
                    marks={b.marks}
                    links={b.links}
                    placeholder={i === blocks.length - 1 ? "글을 쓰거나 '/'로 블록 고르기" : ''}
                    onChange={(v, at) => onLineChange(b, v, at)}
                    onKeyDown={(e, h) => onKey(e, b, h)}
                    onSelect={trackSel}
                  />
                  {items.length > 0 && (
                    <ul className="suggest nb-slash" role="listbox" aria-label="블록 고르기">
                      {items.map((it, k) => (
                        <li key={it.type} role="option" aria-label={it.label} aria-selected={k === slashSel} className={k === slashSel ? 'on' : undefined} ref={k === slashSel ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined} onMouseDown={(e) => (e.preventDefault(), chooseSlash(b, it.type))}>
                          <span className="slash-ico" aria-hidden="true">{it.icon}</span>
                          <span className="slash-txt">
                            <b>{it.label}</b>
                            <small>{it.hint}</small>
                          </span>
                        </li>
                      ))}
                      <li className="slash-foot" aria-hidden="true">↑↓ 고르기 · Enter 넣기 · Esc 닫기</li>
                    </ul>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
      {picked && (() => {
        const b = blocks.find((x) => x.id === picked.id)
        return b ? <FormatBar style={styleAt(b.marks, (b.text ?? '').length, picked.start, picked.end)} top={picked.top} left={picked.left} onApply={applyFormat} onClose={() => setPicked(undefined)} /> : null
      })()}
      <p className="muted nb-hint">파일을 끌어다 놓으면 붙습니다(50MB까지).</p>
    </section>
  )
}

/** 학생 체크 표 블록 */
function RosterTable({ b, onChange }: { b: NoteBlock; onChange: (p: Partial<NoteBlock>) => void }) {
  const rows = b.rows ?? []
  const done = rows.filter((r) => r.checked).length
  const set = (fn: (r: NonNullable<NoteBlock['rows']>[number]) => boolean) => onChange({ rows: rows.map((r) => ({ ...r, checked: fn(r) })) })
  return (
    <div className="nb-roster">
      <table className="grid nb-roster-table" aria-label="학생 체크 표">
        <caption>
          <div className="row nb-roster-head">
            <input aria-label="표 제목" placeholder="표 제목(예: 동의서 제출)" value={b.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
            <span className="muted">{`${done} / ${rows.length}`}</span>
            <button type="button" className="link" onClick={() => set(() => true)}>모두 체크</button>
            <button type="button" className="link" onClick={() => set(() => false)}>모두 해제</button>
          </div>
        </caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sid} className={r.checked ? 'on' : undefined}>
              <td className="pii">{r.label}</td>
              <td>
                <input type="checkbox" aria-label={`${r.label} 체크`} checked={r.checked} onChange={(e) => set((x) => (x.sid === r.sid ? e.target.checked : x.checked))} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
