import type { AppDB } from '../db/schema'
import type { NoticeItemRec } from '../db/types'
import { newRecord, save, scrubDelete } from '../db/records'
import { syncNoticesToNote } from './noteSync'

/** 하루짜리 전달사항이 바뀌면 그날 짝 노트를 맞춘다 */
const resync = async (db: AppDB, ...recs: (NoticeItemRec | undefined)[]) => {
  const days = new Set(recs.filter((r): r is NoticeItemRec => !!r && r.start_date === r.end_date).map((r) => r.start_date))
  for (const d of days) await syncNoticesToNote(db, d)
}

type Patch = Partial<Pick<NoticeItemRec, 'text' | 'start_date' | 'end_date' | 'done' | 'pinned' | 'order' | 'parts'>>

function checkRange(start: string, end: string) {
  const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (!ok(start) || !ok(end)) throw new Error('날짜를 고르세요.')
  if (end < start) throw new Error('끝 날짜가 시작 날짜보다 앞입니다.')
}

async function nextOrder(db: AppDB): Promise<number> {
  const all = await db.notice_items.toArray()
  return all.reduce((m, n) => Math.max(m, n.order), -1) + 1
}

export async function addNotice(db: AppDB, input: { text: string; start_date: string; end_date?: string; parts?: NoticeItemRec['parts'] }): Promise<NoticeItemRec> {
  const text = input.text.trim()
  if (!text) throw new Error('내용을 입력하세요.')
  const end = input.end_date || input.start_date
  checkRange(input.start_date, end)
  const rec = newRecord({ text, start_date: input.start_date, end_date: end, done: false, pinned: false, order: await nextOrder(db), ...(input.parts ? { parts: input.parts } : {}) }) as NoticeItemRec
  await db.notice_items.add(rec)
  await resync(db, rec)
  return (await db.notice_items.get(rec.id)) ?? rec
}

const sortNotices = (a: NoticeItemRec, b: NoticeItemRec) =>
  Number(a.done) - Number(b.done) || Number(b.pinned) - Number(a.pinned) || a.order - b.order

/** 그날 보이는 전달사항: 시작 ≤ 날짜 ≤ 끝. 완료는 아래, 그 안에서 고정 먼저 → 순서. */
export async function noticesOn(db: AppDB, date: string): Promise<NoticeItemRec[]> {
  const rows = await db.notice_items.where('start_date').belowOrEqual(date).toArray()
  return rows.filter((n) => !n.deleted && n.end_date >= date).sort(sortNotices)
}

export async function updateNotice(db: AppDB, id: string, patch: Patch): Promise<NoticeItemRec> {
  const cur = await db.notice_items.get(id)
  if (!cur) throw new Error('전달사항을 찾을 수 없습니다.')
  const next = { ...cur, ...patch }
  if (patch.text !== undefined && !patch.text.trim()) throw new Error('내용을 입력하세요.')
  checkRange(next.start_date, next.end_date)
  const saved = await save(db.notice_items, next)
  await resync(db, cur, saved)
  return (await db.notice_items.get(id)) ?? saved
}

/** 지우고 되돌리기 함수를 돌려준다. */
export async function deleteNotice(db: AppDB, id: string): Promise<() => Promise<void>> {
  const before = await scrubDelete(db.notice_items, id, { text: '' })
  await resync(db, before)
  return async () => {
    if (!before) return
    // 짝 노트의 줄은 지웠으므로 새 줄로 다시 붙는다
    const { block_id: _b, note_id: _n, ...plain } = before
    void _b
    void _n
    await save(db.notice_items, { ...(plain as NoticeItemRec), deleted: false })
    await resync(db, before)
  }
}

/** 그날 보이는 전달사항을 모두 지운다. 되돌리기 함수를 돌려준다. */
export async function clearNoticesOn(db: AppDB, date: string): Promise<() => Promise<void>> {
  const undos: (() => Promise<void>)[] = []
  for (const n of await noticesOn(db, date)) undos.push(await deleteNotice(db, n.id))
  return async () => {
    for (const u of undos) await u()
  }
}

/** 그날 보이는 목록에서 한 칸 위·아래로(순서 값을 맞바꿈). */
export async function moveNotice(db: AppDB, date: string, id: string, dir: -1 | 1): Promise<void> {
  const list = await noticesOn(db, date)
  const i = list.findIndex((n) => n.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const a = list[i]
  const b = list[j]
  await db.transaction('rw', db.notice_items, async () => {
    await save(db.notice_items, { ...a, order: b.order })
    await save(db.notice_items, { ...b, order: a.order })
  })
  await resync(db, a, b)
}

/**
 * 예전 조례·종례 항목을 그날 하루 전달사항으로 옮긴다(조례 먼저). briefings는 그대로 둔다.
 * id를 'brf-<브리핑id>-<순서>'로 정해 두어 켤 때마다 돌아도(백업 복원 뒤 포함) 겹치지 않는다. 지운 항목도 되살리지 않는다.
 */
export async function migrateBriefings(db: AppDB): Promise<number> {
  const rows = (await db.briefings.toArray()).filter((b) => !b.deleted)
  rows.sort((a, b) => (a.target_date < b.target_date ? -1 : a.target_date > b.target_date ? 1 : a.slot === '조례' ? -1 : 1))
  let order = await nextOrder(db)
  let n = 0
  await db.transaction('rw', db.notice_items, async () => {
    for (const b of rows)
      for (const [k, it] of [...b.items].sort((x, y) => x.order - y.order).entries()) {
        if (!it.text.trim()) continue
        const id = `brf-${b.id}-${k}`
        if (await db.notice_items.get(id)) continue
        await db.notice_items.add({ ...newRecord({ text: it.text.trim(), start_date: b.target_date, end_date: b.target_date, done: it.done, pinned: false, order: order++ }), id } as NoticeItemRec)
        n++
      }
  })
  return n
}

/** 끌어 놓은 순서대로: ids(그날 보이는 목록 순서)에 원래 순서 값들을 차례로 다시 준다. */
export async function reorderNotices(db: AppDB, date: string, ids: string[]): Promise<void> {
  const list = await noticesOn(db, date)
  const by = new Map(list.map((n) => [n.id, n]))
  const picked = ids.filter((id) => by.has(id))
  const orders = picked.map((id) => by.get(id)!.order).sort((a, b) => a - b)
  const changed: NoticeItemRec[] = []
  await db.transaction('rw', db.notice_items, async () => {
    for (const [i, id] of picked.entries()) {
      const n = by.get(id)!
      if (n.order !== orders[i]) changed.push(await save(db.notice_items, { ...n, order: orders[i] }))
    }
  })
  await resync(db, ...changed)
}

export interface NoticeDateGroup {
  /** 묶음 열쇠(하루짜리는 날짜, 여러 날은 'start~end') */
  key: string
  label: string
  start: string
  items: NoticeItemRec[]
}
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`

/** 날짜별 묶음: 보고 있는 날(date) 하루짜리는 빼고, 앞날짜(가까운 순)·여러 날(진행·앞으로)·지난 날짜(최근 순). */
export async function noticeDateGroups(db: AppDB, date: string): Promise<{ upcoming: NoticeDateGroup[]; ranges: NoticeDateGroup[]; past: NoticeDateGroup[] }> {
  const all = (await db.notice_items.toArray()).filter((n) => !n.deleted)
  const groups = new Map<string, NoticeDateGroup>()
  for (const n of all) {
    const one = n.start_date === n.end_date
    if (one && n.start_date === date) continue
    const key = one ? n.start_date : `${n.start_date}~${n.end_date}`
    const g = groups.get(key) ?? { key, label: one ? md(n.start_date) : `${md(n.start_date)}~${md(n.end_date)}`, start: n.start_date, items: [] }
    g.items.push(n)
    groups.set(key, g)
  }
  const list = [...groups.values()].map((g) => ({ ...g, items: g.items.sort(sortNotices) }))
  const isRange = (g: NoticeDateGroup) => g.key.includes('~')
  const endOf = (g: NoticeDateGroup) => (isRange(g) ? g.key.split('~')[1] : g.start)
  const asc = (a: NoticeDateGroup, b: NoticeDateGroup) => a.key.localeCompare(b.key)
  return {
    upcoming: list.filter((g) => !isRange(g) && g.start > date).sort(asc),
    ranges: list.filter((g) => isRange(g) && endOf(g) >= date).sort(asc),
    past: list.filter((g) => endOf(g) < date).sort((a, b) => endOf(b).localeCompare(endOf(a))),
  }
}
