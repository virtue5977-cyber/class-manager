/**
 * 하루 전달사항 ↔ 노트 한 장(짝 노트, NoteRec.notice_date).
 * 노트의 글 줄(문단·목록·체크, 글이 있는 것) 하나 = 그날 하루짜리 전달사항 한 항목(block_id로 짝).
 * 여기서는 표 쓰기만 직접 한다(전달사항·노트 lib을 부르지 않아 서로 다시 부르지 않는다).
 */
import type { AppDB } from '../db/schema'
import type { NoteBlock, NoteRec, NoticeItemRec, TodoPart } from '../db/types'
import { newRecord, save } from '../db/records'
import { shiftMarks } from '../notes/marks'
import { linksFromParts } from '../notes/noteLinks'

const newBlockId = () => crypto.randomUUID().slice(0, 8)
const LINE_TYPES = new Set<NoteBlock['type']>(['p', 'bullet', 'number', 'check'])
/** 전달사항이 되는 줄 */
export const isNoticeLine = (b: NoteBlock) => LINE_TYPES.has(b.type) && !!(b.text ?? '').trim()

const WD = '일월화수목금토'
export function noticeNoteTitle(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  return `[전달사항] ${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})`
}

/** 그날 짝 노트(지운 것 빼고) */
export async function noticeNoteOf(db: AppDB, date: string): Promise<NoteRec | undefined> {
  return (await db.notes.toArray()).find((n) => !n.deleted && n.notice_date === date)
}

const oneDay = (n: NoticeItemRec, date: string) => n.start_date === date && n.end_date === date

/** 노트 줄의 링크 → 전달사항 parts(링크가 없으면 undefined) */
export function partsOfBlock(b: NoteBlock): TodoPart[] | undefined {
  const t = b.text ?? ''
  const links = [...(b.links ?? [])].sort((x, y) => x.from - y.from)
  if (!links.length) return undefined
  const out: TodoPart[] = []
  let at = 0
  for (const l of links) {
    if (l.from > at) out.push(t.slice(at, l.from))
    out.push({ note: l.note })
    at = l.to
  }
  if (at < t.length) out.push(t.slice(at))
  return out
}

/** 짝 노트를 저장한 뒤: 그날 하루짜리 전달사항을 노트 줄에 맞춘다(더하기·고치기·지우기·순서·체크). */
export async function syncNoteToNotices(db: AppDB, noteId: string): Promise<void> {
  await db.transaction('rw', db.notes, db.notice_items, async () => {
    const note = await db.notes.get(noteId)
    if (!note || note.deleted || !note.notice_date) return
    const date = note.notice_date
    const all = await db.notice_items.toArray()
    const mine = all.filter((n) => !n.deleted && n.note_id === noteId)
    const lines = note.blocks.filter(isNoticeLine)
    const keep = new Set(lines.map((b) => b.id))
    for (const n of mine) if (!n.block_id || !keep.has(n.block_id)) await save(db.notice_items, { ...n, deleted: true, text: '' })
    const orders = mine.filter((n) => n.block_id && keep.has(n.block_id)).map((n) => n.order).sort((a, b) => a - b)
    let next = all.reduce((m, n) => Math.max(m, n.order), -1) + 1
    for (const b of lines) {
      const cur = mine.find((n) => n.block_id === b.id)
      const text = (b.text ?? '').trim()
      const parts = partsOfBlock(b)
      const order = orders.length ? orders.shift()! : next++
      const done = b.type === 'check' ? !!b.checked : (cur?.done ?? false)
      if (cur) {
        if (cur.text !== text || cur.order !== order || cur.done !== done || JSON.stringify(cur.parts) !== JSON.stringify(parts) || !oneDay(cur, date))
          await save(db.notice_items, { ...cur, text, order, done, start_date: date, end_date: date, ...(parts ? { parts } : { parts: undefined }) })
      } else {
        const rec = newRecord({ text, start_date: date, end_date: date, done, pinned: false, order, note_id: noteId, block_id: b.id, ...(parts ? { parts } : {}) }) as NoticeItemRec
        await db.notice_items.add(rec)
      }
    }
  })
}

/** 전달사항을 고친 뒤: 그날 짝 노트가 있으면 노트 줄을 전달사항에 맞춘다. 짝 없는 그날 하루짜리 전달사항은 노트 끝에 체크 줄로 더한다. */
export async function syncNoticesToNote(db: AppDB, date: string): Promise<void> {
  await db.transaction('rw', db.notes, db.notice_items, async () => {
    const note = (await db.notes.toArray()).find((n) => !n.deleted && n.notice_date === date)
    if (!note) return
    const items = (await db.notice_items.toArray()).filter((n) => n.note_id === note.id || (!n.deleted && oneDay(n, date) && !n.note_id))
    const live = items.filter((n) => !n.deleted && oneDay(n, date)).sort((a, b) => a.order - b.order)
    const gone = new Set(items.filter((n) => n.deleted && n.block_id && !live.some((l) => l.block_id === n.block_id)).map((n) => n.block_id!))
    // 날짜를 옮긴(하루짜리가 아니게 된) 항목의 줄도 노트에서 뺀다
    for (const n of items) if (!n.deleted && n.note_id === note.id && n.block_id && !oneDay(n, date)) gone.add(n.block_id)
    let blocks = note.blocks.filter((b) => !gone.has(b.id))
    const byId = new Map(blocks.map((b) => [b.id, b]))
    // 고치기·체크·@노트 링크
    const allNotes = await db.notes.toArray()
    const titleOf = (id: string) => allNotes.find((x) => x.id === id && !x.deleted)?.title
    const linksOf = (n: NoticeItemRec) => linksFromParts(n.text, n.parts, titleOf)
    for (const n of live) {
      const b = n.block_id ? byId.get(n.block_id) : undefined
      if (!b) continue
      const t = b.text ?? ''
      const links = linksOf(n)
      if (t.trim() !== n.text || JSON.stringify(b.links ?? []) !== JSON.stringify(links)) {
        const nb: NoteBlock = { ...b, text: n.text, marks: t.trim() !== n.text ? shiftMarks(b.marks, t, n.text) : b.marks, links }
        if (!nb.marks?.length) delete nb.marks
        if (!nb.links?.length) delete nb.links
        byId.set(b.id, nb)
      }
      if (b.type === 'check' && !!b.checked !== n.done) byId.set(b.id, { ...byId.get(b.id)!, checked: n.done })
    }
    blocks = blocks.map((b) => byId.get(b.id) ?? b)
    // 순서: 짝 줄들이 있던 자리에 전달사항 순서대로
    const linked = live.filter((n) => n.block_id && byId.has(n.block_id)).map((n) => n.block_id!)
    const slots = blocks.map((b, i) => (linked.includes(b.id) ? i : -1)).filter((i) => i >= 0)
    const ordered = [...blocks]
    slots.forEach((slot, k) => (ordered[slot] = byId.get(linked[k])!))
    blocks = ordered
    // 새 항목(짝 줄 없음) → 끝에 체크 줄(노트가 빈 줄 하나뿐이면 그 줄 대신)
    const fresh = live.filter((n) => !(n.block_id && byId.has(n.block_id)))
    if (fresh.length && blocks.length === 1 && blocks[0].type === 'p' && !(blocks[0].text ?? '').trim()) blocks = []
    for (const n of fresh) {
      const links = linksOf(n)
      const b: NoteBlock = { id: newBlockId(), type: 'check', text: n.text, checked: n.done, ...(links.length ? { links } : {}) }
      blocks = [...blocks, b]
      await save(db.notice_items, { ...n, note_id: note.id, block_id: b.id })
    }
    if (!blocks.length) blocks = [{ id: newBlockId(), type: 'p', text: '' }]
    if (JSON.stringify(blocks) !== JSON.stringify(note.blocks)) await save(db.notes, { ...note, blocks })
  })
}

/** 그날 짝 노트를 열기(없으면 만들고 그날 하루짜리 전달사항을 넣는다) */
export async function openNoticeNote(db: AppDB, date: string): Promise<NoteRec> {
  const had = await noticeNoteOf(db, date)
  if (had) return had
  const rec = newRecord({ title: noticeNoteTitle(date), blocks: [{ id: newBlockId(), type: 'p', text: '' }], pinned: false, notice_date: date }) as NoteRec
  await db.notes.add(rec)
  await syncNoticesToNote(db, date)
  return (await db.notes.get(rec.id))!
}

/**
 * 노트를 그날 전달사항과 짝짓기. 그날 이미 짝 노트가 있으면
 * merge: 그 노트의 짝을 풀고 그 전달사항은 이 노트에 더한다 / replace: 그 노트에서 온 전달사항은 지우고 이 노트로.
 */
export async function linkNoteToDate(db: AppDB, noteId: string, date: string, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
  const old = await noticeNoteOf(db, date)
  if (old && old.id !== noteId) {
    await db.transaction('rw', db.notes, db.notice_items, async () => {
      const { notice_date: _d, ...rest } = old
      void _d
      await save(db.notes, rest as NoteRec)
      for (const n of await db.notice_items.toArray())
        if (n.note_id === old.id && !n.deleted) {
          const { note_id: _n, block_id: _b, ...plain } = n
          void _n
          void _b
          await save(db.notice_items, mode === 'replace' ? { ...n, deleted: true, text: '' } : (plain as NoticeItemRec))
        }
    })
  }
  await db.transaction('rw', db.notes, async () => {
    const cur = await db.notes.get(noteId)
    if (cur && !cur.deleted) await save(db.notes, { ...cur, notice_date: date })
  })
  await syncNoteToNotices(db, noteId)
  await syncNoticesToNote(db, date)
}

/** 짝 풀기: 전달사항은 남기고 연결만 끊는다(노트를 지울 때도) */
export async function unlinkNoticeNote(db: AppDB, noteId: string): Promise<void> {
  await db.transaction('rw', db.notes, db.notice_items, async () => {
    const cur = await db.notes.get(noteId)
    if (cur && cur.notice_date) {
      const { notice_date: _d, ...rest } = cur
      void _d
      await save(db.notes, rest as NoteRec)
    }
    for (const n of await db.notice_items.toArray())
      if (n.note_id === noteId) {
        const { note_id: _n, block_id: _b, ...plain } = n
        void _n
        void _b
        await save(db.notice_items, plain as NoticeItemRec)
      }
  })
}
