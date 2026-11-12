import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useDb, useFs } from '../../app/context'
import type { NoteBlock, NoteBlockType, NoteRec } from '../../lib/db/types'
import { attachFile, MAX_FILE, newBlockId, readFile, saveNoteContent } from '../../lib/notes/notes'
import { filterSlash, indentBlock, markdownPrefix, mergeUp, moveBlock, noteShortcut, outlineMarks, rosterBlock, setType, splitBlock } from '../../lib/notes/blocks'
import { caretNav, placeCaret } from '../../lib/ui/caretNav'
import RichLine, { type LineHandle, type LineValue } from './RichLine'
import NoteToolbar, { type InsertKind, type MarkKey } from './NoteToolbar'
import NoteTable from './NoteTable'
import { newTable } from '../../lib/notes/tableOps'
import { applyStyle, forceStyle, styleAt, type Style } from '../../lib/notes/marks'
import { getSel } from '../../lib/notes/richDom'
import { copyRich, noteToHtml, noteToPlain } from '../../lib/notes/toHtml'
import { useLive } from '../../lib/ui/useLive'
import { linkNoteToDate, noticeNoteOf, unlinkNoticeNote } from '../../lib/notices/noteSync'
import { listNotes } from '../../lib/notes/notes'
import { matchNotes, mentionAt, type NoteTitle } from '../../lib/notes/noteLinks'
import { shiftLinks, shiftMarks } from '../../lib/notes/marks'
import NoteMentionList from '../../components/NoteMentionList'
import { useNavigate } from 'react-router-dom'
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
  const navigate = useNavigate()
  // '@'로 다른 노트 연결
  const allNotes = useLive<NoteRec[]>(() => listNotes(db), [db], [])
  const [men, setMen] = useState<{ id: string; start: number; q: string; caret: number }>()
  const [menSel, setMenSel] = useState(0)
  const menItems: NoteTitle[] = men ? matchNotes(allNotes, men.q, note.id) : []
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
  /** 여러 줄 고르기(줄째): 한 줄에서 끌기 시작해 다른 줄로 가면(위·아래 모두) */
  const [bsel, setBsel] = useState<{ a: number; h: number }>()
  const blocksBox = useRef<HTMLDivElement>(null)
  const inSel = (i: number) => !!bsel && i >= Math.min(bsel.a, bsel.h) && i <= Math.max(bsel.a, bsel.h)
  function startLineSelect(e: React.PointerEvent) {
    if (e.button > 0 || e.shiftKey) return
    const row = (e.target as Element).closest('.nb')
    if (!row || !(e.target as Element).closest('[contenteditable]')) return
    const all = () => Array.from(blocksBox.current?.querySelectorAll('.nb') ?? [])
    const a = all().indexOf(row)
    if (a < 0) return
    setBsel(undefined)
    let on = false
    const move = (ev: PointerEvent) => {
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.nb')
      const h = over ? all().indexOf(over) : -1
        if (h < 0 || (!on && h === a)) return
      on = true
      // 글자 고르기 대신 줄째 고르기
      window.getSelection?.()?.removeAllRanges()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      setBsel({ a, h })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  // 줄째 고른 동안: Esc 풀기, Delete·Backspace 지우기, Ctrl+C·X 복사(서식째)·잘라내기, 다른 곳 누르면 풀기
  useEffect(() => {
    if (!bsel) return
    const lo = Math.min(bsel.a, bsel.h)
    const hi = Math.max(bsel.a, bsel.h)
    const chosen = () => blocks.slice(lo, hi + 1)
    const removeChosen = () => {
      const ids = new Set(chosen().map((b) => b.id))
      setBlocks((bs) => {
        const rest = bs.filter((b) => !ids.has(b.id))
        return rest.length ? rest : [{ id: newBlockId(), type: 'p', text: '' }]
      })
      setBsel(undefined)
    }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return
      // 다른 입력칸(명령 막대 등)에 친 키는 그 칸 몫: 줄 고르기를 풀고 손대지 않는다
      const t = e.target as HTMLElement | null
      if (t && t !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return setBsel(undefined)
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') return (e.preventDefault(), setBsel(undefined))
      if (e.key === 'Delete' || e.key === 'Backspace') return (e.preventDefault(), removeChosen())
      if (mod && /^[cx]$/i.test(e.key)) {
        e.preventDefault()
        const part = { title: '', blocks: chosen() }
        void copyRich(noteToHtml(part), noteToPlain(part)).then(() => setMsg(`${hi - lo + 1}줄을 복사했습니다.`))
        if (/x/i.test(e.key)) removeChosen()
        return
      }
      if (!mod && !e.altKey && e.key.length === 1) setBsel(undefined)
    }
    const down = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.nb-selected')) setBsel(undefined)
    }
    // 다른 칸에 초점이 가면(Ctrl+K 등) 풀기
    const focus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) setBsel(undefined)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('mousedown', down)
    document.addEventListener('focusin', focus)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('mousedown', down)
      document.removeEventListener('focusin', focus)
    }
  }, [bsel, blocks])
  /** 글자를 고른 줄(서식 막대) */
  /** 도구 막대: 지금 줄과 고른 범위(커서만이면 start = end) */
  const [cur, setCur] = useState<{ id: string; start: number; end: number }>()
  /** 고른 글 없이 누른 글자 서식: 그 자리에서 다음에 칠 글자에 쓴다 */
  const pending = useRef<{ id: string; at: number; style: Record<string, unknown> } | undefined>(undefined)
  const [, bump] = useState(0)
  const setPend = (v: typeof pending.current) => {
    pending.current = v
    bump((n) => n + 1)
  }
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
  const saved = useRef({ title: note.title, blocks: JSON.stringify(note.blocks) })
  const persist = useCallback(
    (t: string, bs: NoteBlock[]) => {
      const j = JSON.stringify(bs)
      if (t === saved.current.title && j === saved.current.blocks) return
      saved.current = { title: t, blocks: j }
      void saveNoteContent(db, note.id, { title: t, blocks: bs })
    },
    [db, note.id],
  )
  useEffect(() => {
    const t = setTimeout(() => persist(title, blocks), 500)
    return () => clearTimeout(t)
  }, [persist, title, blocks])
  useEffect(() => () => persist(latest.current.title, latest.current.blocks), [persist])
  // 다른 곳(전달사항 칸 등)에서 노트가 바뀌면 받아 온다(내가 저장한 것과 다를 때만)
  const live = useLive<NoteRec | undefined>(() => db.notes.get(note.id), [db, note.id], note)
  useEffect(() => {
    if (!live || live.deleted) return
    const j = JSON.stringify(live.blocks)
    if (j === saved.current.blocks || j === JSON.stringify(latest.current.blocks)) return
    saved.current = { ...saved.current, blocks: j }
    setBlocks(live.blocks.length ? live.blocks : [{ id: newBlockId(), type: 'p', text: '' }])
  }, [live])
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
  const slashOf = (b: NoteBlock) => {
    if (slashOff === b.id) return null
    const t = b.text ?? ''
    // 줄 전체가 '/…'이거나, 글 끝에서 띄어쓰기 뒤 '/…'(띄어쓰기 없는 12자까지)
    return /^\/([^\n]{0,12})$/.exec(t)?.[1] ?? /\s\/([^\s/]{0,12})$/.exec(t)?.[1] ?? null
  }
  /** '/…'를 뺀 앞 글(줄 중간에서 연 경우) */
  const beforeSlash = (b: NoteBlock) => {
    const t = b.text ?? ''
    return /^\/[^\n]{0,12}$/.test(t) ? '' : t.replace(/\s\/[^\s/]{0,12}$/, '')
  }

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
    // 줄 중간에서 연 경우: 앞 글은 남긴다. 글 블록이면 모양만 바꾸고, 표·구분선·파일·폴더는 다음 줄에 새로.
    const keep = beforeSlash(b)
    if (keep) {
      const cut = <T extends { from: number; to: number }>(xs?: T[]) => (xs ?? []).filter((x) => x.from < keep.length).map((x) => ({ ...x, to: Math.min(x.to, keep.length) }))
      const kept = { text: keep, marks: cut(b.marks).length ? cut(b.marks) : undefined, links: cut(b.links).length ? cut(b.links) : undefined }
      if (['p', 'h1', 'h2', 'check', 'bullet', 'number'].includes(type)) {
        setBlocks((bs) => setType(bs.map((x) => (x.id === b.id ? { ...x, ...kept } : x)), b.id, type).map((x) => (x.id === b.id ? { ...x, ...kept } : x)))
        focusNext.current = { id: b.id, caret: keep.length }
        return
      }
      const nb: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
      setBlocks((bs) => {
        const i = bs.findIndex((x) => x.id === b.id)
        return [...bs.slice(0, i), { ...bs[i], ...kept }, nb, ...bs.slice(i + 1)]
      })
      return chooseSlash(nb, type)
    }
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
    const pd = pending.current
    const grew = v.text.length - (b.text ?? '').length
    if (pd && pd.id === b.id && grew > 0 && at - grew === pd.at) {
      let mk = v.marks
      for (const [k, val] of Object.entries(pd.style)) mk = forceStyle(mk, v.text.length, at - grew, at, k as MarkKey, val as string | number | boolean | undefined)
      v = { ...v, marks: mk }
      pending.current = { ...pd, at }
    }
    update(b.id, { text: v.text, marks: v.marks?.length ? v.marks : undefined, links: v.links?.length ? v.links : undefined })
    const m = mentionAt(v.text, at)
    setMen(m ? { id: b.id, ...m, caret: at } : undefined)
    setMenSel(0)
    setSlashSel(0)
    if (slashOff === b.id && !v.text.startsWith('/')) setSlashOff(undefined)
  }

  /** '@제목'을 넣고 그 자리를 노트 링크로 */
  function pickMention(b: NoteBlock, n: NoteTitle) {
    if (!men) return
    const old = b.text ?? ''
    const ins = `@${n.title}`
    const text = `${old.slice(0, men.start)}${ins} ${old.slice(men.caret)}`
    const links = [...shiftLinks(b.links, old, text).filter((l) => l.to <= men.start || l.from >= men.start + ins.length), { from: men.start, to: men.start + ins.length, note: n.id }].sort((x, y) => x.from - y.from)
    const marks = shiftMarks(b.marks, old, text)
    update(b.id, { text, links, marks: marks.length ? marks : undefined })
    focusNext.current = { id: b.id, caret: men.start + ins.length + 1 }
    setMen(undefined)
  }

  /** 글자를 고르면 서식 막대를 띄운다 */
  const trackSel = useCallback(() => {
    for (const [id, h] of refs.current) {
      const d = h.el
      if (!d || d.ownerDocument.activeElement !== d) continue
      const sel = getSel(d)
      // 도구 막대가 쓸 '지금 줄·고른 범위'(다른 곳을 눌러도 남는다)
      if (sel) {
        const c = { id, start: Math.min(sel.start, sel.end), end: Math.max(sel.start, sel.end) }
        setCur((o) => (o && o.id === c.id && o.start === c.start && o.end === c.end ? o : c))
        // 다음에 칠 서식은 커서가 친 자리에서 벗어나면 버린다
        if (pending.current && (pending.current.id !== id || c.start !== pending.current.at || c.end !== c.start)) setPend(undefined)
      }
      return
    }
  }, [])
  useEffect(() => {
    document.addEventListener('selectionchange', trackSel)
    return () => document.removeEventListener('selectionchange', trackSel)
  }, [trackSel])

  /** 막 넣은 표(첫 칸에 커서) */
  const freshTable = useRef<string | null>(null)
  function insertTable(o: { rows: number; cols: number }) {
    const nb: NoteBlock = { id: newBlockId(), type: 'table', ...newTable(o.rows, o.cols) }
    freshTable.current = nb.id
    insertAfterCur(nb, 'none')
  }
  async function pickImage() {}
  // ---- 도구 막대 ----
  const curBlock = cur ? blocks.find((x) => x.id === cur.id) : undefined
  const curStyle: Style = (() => {
    if (!curBlock || !cur) return {}
    const len = (curBlock.text ?? '').length
    const base = styleAt(curBlock.marks, len, cur.start, cur.end) as Record<string, unknown>
    const pd = pending.current && pending.current.id === cur.id && cur.start === cur.end ? pending.current.style : {}
    const out = { ...base, ...pd }
    for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === false) delete out[k]
    return out as Style
  })()
  const backTo = (id: string, start: number, end: number) => requestAnimationFrame(() => refs.current.get(id)?.setSelectionRange(start, end))
  function tbMark(k: MarkKey, v?: string | number) {
    if (!curBlock || !cur) return setMsg('글을 고르거나 쓸 줄을 누르세요.')
    const len = (curBlock.text ?? '').length
    if (cur.start !== cur.end) {
      const marks = applyStyle(curBlock.marks, len, cur.start, cur.end, k, v)
      update(curBlock.id, { marks: marks.length ? marks : undefined })
      return backTo(curBlock.id, cur.start, cur.end)
    }
    // 고른 글이 없으면 다음에 칠 글자에(켜고 끄기는 지금 상태의 반대로)
    const now = (curStyle as Record<string, unknown>)[k]
    const want = v === undefined ? !now : now === v ? undefined : v
    const prev = pending.current && pending.current.id === cur.id && pending.current.at === cur.start ? pending.current.style : {}
    setPend({ id: cur.id, at: cur.start, style: { ...prev, [k]: want } })
    backTo(curBlock.id, cur.start, cur.start)
  }
  const tbBlock = (patch: (b: NoteBlock) => Partial<NoteBlock>) => {
    if (!curBlock || !cur) return setMsg('바꿀 줄을 누르세요.')
    update(curBlock.id, patch(curBlock))
    backTo(curBlock.id, cur.start, cur.end)
  }
  function tbType(t: NoteBlockType) {
    if (!curBlock || !cur) return
    setBlocks((bs) => setType(bs, curBlock.id, t))
    focusNext.current = { id: curBlock.id, caret: cur.start }
  }
  function tbIndent(dir: 1 | -1) {
    if (!curBlock || !cur) return
    setBlocks((bs) => indentBlock(bs, curBlock.id, dir))
    backTo(curBlock.id, cur.start, cur.end)
  }
  /** 지금 줄 다음에 블록 넣기(지금 줄이 비어 있으면 그 자리에) */
  function insertAfterCur(nb: NoteBlock, focus: 'next' | 'new' | 'none' = 'next') {
    setBlocks((bs) => {
      const i = curBlock ? bs.findIndex((x) => x.id === curBlock.id) : bs.length - 1
      const empty = curBlock && curBlock.type === 'p' && !(curBlock.text ?? '').trim()
      const tail: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
      const out = empty ? [...bs.slice(0, i), nb, ...bs.slice(i + 1)] : [...bs.slice(0, i + 1), nb, ...bs.slice(i + 1)]
      const at = out.indexOf(nb)
      if (at === out.length - 1) out.push(tail)
      if (focus !== 'none') focusNext.current = focus === 'new' ? { id: nb.id, caret: 0 } : { id: out[at + 1].id, caret: 0 }
      return out
    })
  }
  function tbInsert(k: InsertKind, o?: { rows: number; cols: number }) {
    if (k === 'divider') return insertAfterCur({ id: newBlockId(), type: 'divider' })
    if (k === 'pagebreak') return insertAfterCur({ id: newBlockId(), type: 'pagebreak' })
    if (k === 'file') {
      const nb: NoteBlock = { id: newBlockId(), type: 'p', text: '' }
      insertAfterCur(nb, 'new')
      return void chooseSlash(nb, 'file')
    }
    if (k === 'table') return insertTable(o ?? { rows: 2, cols: 2 })
    if (k === 'image') return void pickImage()
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>, b: NoteBlock, el: LineHandle) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY' || /^[zy]$/i.test(e.key))) {
      e.preventDefault()
      const redo = e.code === 'KeyY' || e.key.toLowerCase() === 'y' || e.shiftKey
      return stepHistory(redo ? 1 : -1, b.id)
    }
    if (men && men.id === b.id && menItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setMenSel((i) => (i + (e.key === 'ArrowDown' ? 1 : menItems.length - 1)) % menItems.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return pickMention(b, menItems[Math.min(menSel, menItems.length - 1)])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setMen(undefined)
      }
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

  /** 노트 전체를 그날 전달사항과 잇기(이미 다른 노트가 이어져 있으면 합치기·바꾸기를 묻는다) */
  const [clash, setClash] = useState<string>()
  async function linkAll(mode?: 'merge' | 'replace') {
    try {
      if (!mode) {
        const other = await noticeNoteOf(db, range.start)
        if (other && other.id !== note.id) return setClash(other.title || '제목 없음')
      }
      persist(title, blocks)
      await linkNoteToDate(db, note.id, range.start, mode ?? 'merge')
      setSendFor(undefined)
      setClash(undefined)
      setMsg(`${+range.start.slice(5, 7)}/${+range.start.slice(8)} 전달사항과 이었습니다. 여기서 고치면 전달사항도 바뀝니다.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  /** 기간을 정해 블록 하나를 전달사항으로 보내기 */
  async function sendNotices() {
    const targets = blocks.filter((x) => x.id === sendFor)
    try {
      for (const x of targets) await addNotice(db, { text: x.text!.trim(), start_date: range.start, end_date: range.end })
      setMsg(`전달사항 ${targets.length}개를 보냈습니다.`)
      setSendFor(undefined)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  /** 노트 전체를 서식째 복사(한글에 붙여 넣기) */
  async function copyForHwp() {
    const names = new Map<string, string>()
    for (const b of blocks) if (b.type === 'file' && b.file_id) names.set(b.file_id, fileInfo[b.file_id]?.name ?? '파일')
    const n = { title, blocks }
    const ok = await copyRich(noteToHtml(n, { files: names }), noteToPlain(n))
    setMsg(ok ? '복사했습니다. 한글에서 Ctrl+V로 붙여 넣으세요.' : '복사하지 못했습니다. 글을 골라 Ctrl+C를 눌러 보세요.')
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
      <div className="note-head">
        <input className="note-title" aria-label="노트 제목" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" />
        <div className="row note-tools">
          <button type="button" className="link" title="서식을 살려 복사합니다. 한글·워드에 붙여 넣으세요." onClick={copyForHwp}>한글로 복사</button>
          {live?.notice_date ? (
            <>
              <span className="badge notice-badge" title="이날 전달사항과 이어진 노트입니다. 글 줄 하나가 전달사항 한 항목입니다.">{`[전달 ${+live.notice_date.slice(5, 7)}/${+live.notice_date.slice(8)}]`}</span>
              <button type="button" className="link" onClick={() => void unlinkNoticeNote(db, note.id).then(() => setMsg('전달사항과 연결을 끊었습니다. 전달사항은 그대로 남습니다.'))}>연결 끊기</button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => { setRange({ start: today, end: today }); setSendFor('all') }}>노트 전체를 전달사항으로</button>
          )}
        </div>
      </div>
      <NoteToolbar
        block={curBlock}
        style={curStyle}
        onType={tbType}
        onIndent={tbIndent}
        onAlign={(a) => tbBlock(() => ({ align: a === 'justify' ? undefined : a }))}
        onLine={(n) => tbBlock(() => ({ line: n === 160 ? undefined : n }))}
        onMark={tbMark}
        onInsert={tbInsert}
        onUndo={() => stepHistory(-1, cur?.id ?? '')}
        onRedo={() => stepHistory(1, cur?.id ?? '')}
      />
      {msg && <p className="notice" role="status">{msg}</p>}
      {sendFor === 'all' && (
        <div className="row card send-range" role="group" aria-label="전달사항 날짜">
          <span>이 노트를 이날 전달사항으로(글 줄 하나 = 한 항목, 서로 이어짐):</span>
          <input type="date" aria-label="날짜" value={range.start} onChange={(e) => setRange({ start: e.target.value, end: e.target.value })} />
          {clash ? (
            <>
              <span className="muted">{`이날 이미 '${clash}' 노트가 이어져 있습니다.`}</span>
              <button type="button" className="primary" onClick={() => linkAll('merge')}>합치기</button>
              <button type="button" onClick={() => linkAll('replace')}>바꾸기</button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => linkAll()}>잇기</button>
          )}
          <button type="button" className="link" onClick={() => (setSendFor(undefined), setClash(undefined))}>취소</button>
        </div>
      )}
      {sendFor && sendFor !== 'all' && (
        <div className="row card send-range" role="group" aria-label="전달사항 기간">
          <span>이 블록을 전달사항으로:</span>
          <input type="date" aria-label="시작" value={range.start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} />
          ~
          <input type="date" aria-label="끝" value={range.end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} />
          <button type="button" className="primary" onClick={sendNotices}>보내기</button>
          <button type="button" className="link" onClick={() => setSendFor(undefined)}>취소</button>
        </div>
      )}
      <div className="note-blocks" ref={blocksBox} onPointerDown={startLineSelect}>
        {blocks.map((b, i) => {
          const lv = b.indent ?? 0
          const q = slashOf(b)
          const items = q !== null ? filterSlash(q) : []
          return (
            <div
              key={b.id}
              className={`nb nb-${b.type} nb-l${lv}${b.align ? ` al-${b.align}` : ''}${b.line ? ` ln-${b.line}` : ''}${dragId === b.id ? ' dragging' : ''}${inSel(i) ? ' nb-selected' : ''}`}
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
              {b.type === 'table' ? (
                <NoteTable b={b} autoFocus={freshTable.current === b.id} onChange={(patch) => update(b.id, patch)} onDelete={() => setBlocks((bs) => (bs.length > 1 ? bs.filter((x) => x.id !== b.id) : [{ id: newBlockId(), type: 'p', text: '' }]))} />
              ) : b.type === 'pagebreak' ? (
                <div className="nb-pagebreak" role="separator" aria-label="쪽 나눔"><span>쪽 나눔</span></div>
              ) : b.type === 'roster' ? (
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
                    onOpenLink={(id) => navigate(`/notes?id=${id}`)}
                    onBlur={() => setMen((m) => (m?.id === b.id ? undefined : m))}
                  />
                  {men?.id === b.id && <NoteMentionList items={menItems} sel={menSel} onPick={(x) => pickMention(b, x)} />}
                  {items.length > 0 && (
                    <ul className="suggest nb-slash" role="listbox" aria-label="블록 고르기">
                      {items.map((it, k) => (
                        <li key={it.type} role="option" aria-label={it.label} aria-selected={k === slashSel} className={k === slashSel ? 'on' : undefined} ref={k === slashSel ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined} onMouseDown={(e) => (e.preventDefault(), chooseSlash(b, it.type))}>
                          <span className="slash-ico" aria-hidden="true">{it.icon}</span>
                          <span className="slash-txt">
                            <b>{it.label}</b>
                            <small>{it.hint.split(' · ').filter((h) => !/^Ctrl/.test(h)).join(' · ')}</small>
                          </span>
                          {/Ctrl\+[^ ·]+/.exec(it.hint) && <kbd className="slash-key">{/Ctrl\+[^ ·]+/.exec(it.hint)![0]}</kbd>}
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

      <p className="muted nb-hint">파일을 끌어다 놓으면 붙습니다(50MB까지).</p>
    </section>
  )
}

/** 학생 체크 표 블록 */
function RosterTable({ b, onChange }: { b: NoteBlock; onChange: (p: Partial<NoteBlock>) => void }) {
  const rows = b.rows ?? []
  const done = rows.filter((r) => r.checked).length
  const size = b.size ?? 'md'
  const set = (fn: (r: NonNullable<NoteBlock['rows']>[number]) => boolean) => onChange({ rows: rows.map((r) => ({ ...r, checked: fn(r) })) })
  const shown = b.hide_done ? rows.filter((r) => !r.checked) : rows
  return (
    <div className={`nb-roster nb-roster-${size}${b.collapsed ? ' collapsed' : ''}`}>
      <table className="grid nb-roster-table" aria-label="학생 체크 표">
        <caption>
      <div className="row nb-roster-head">
        <input aria-label="표 제목" placeholder="표 제목(예: 동의서 제출)" value={b.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} />
        <span className="muted">{`${done} / ${rows.length}`}</span>
        <button type="button" className="link" onClick={() => set(() => true)}>모두 체크</button>
        <button type="button" className="link" onClick={() => set(() => false)}>모두 해제</button>
        <button type="button" className="link" onClick={() => onChange({ hide_done: !b.hide_done })}>
          {b.hide_done ? `체크한 학생 보이기(${done})` : '체크한 학생 숨기기'}
        </button>
        <span className="seg-mini" role="radiogroup" aria-label="표 크기">
          {(['sm', 'md', 'lg'] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={size === k} className={size === k ? 'on' : undefined} onClick={() => onChange({ size: k })}>
              {k === 'sm' ? '작게' : k === 'md' ? '보통' : '크게'}
            </button>
          ))}
        </span>
        <button type="button" className="link" onClick={() => onChange({ collapsed: !b.collapsed })}>{b.collapsed ? '표 펴기' : '표 접기'}</button>
      </div>
        </caption>
      {!b.collapsed && (
          <tbody>
            {shown.map((r) => (
              <tr key={r.sid} className={r.checked ? 'on' : undefined}>
                <td className="pii">{r.label}</td>
                <td>
                  <input type="checkbox" aria-label={`${r.label} 체크`} checked={r.checked} onChange={(e) => set((x) => (x.sid === r.sid ? e.target.checked : x.checked))} />
                </td>
              </tr>
            ))}
          </tbody>
      )}
      </table>
    </div>
  )
}
