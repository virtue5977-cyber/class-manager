import type { AppDB } from '../db/schema'
import type { NoticeItemRec } from '../db/types'
import { newRecord, save, scrubDelete } from '../db/records'

type Patch = Partial<Pick<NoticeItemRec, 'text' | 'start_date' | 'end_date' | 'done' | 'pinned' | 'order'>>

function checkRange(start: string, end: string) {
  if (end < start) throw new Error('끝 날짜가 시작 날짜보다 앞입니다.')
}

async function nextOrder(db: AppDB): Promise<number> {
  const all = await db.notice_items.toArray()
  return all.reduce((m, n) => Math.max(m, n.order), -1) + 1
}

export async function addNotice(db: AppDB, input: { text: string; start_date: string; end_date?: string }): Promise<NoticeItemRec> {
  const text = input.text.trim()
  if (!text) throw new Error('내용을 입력하세요.')
  const end = input.end_date || input.start_date
  checkRange(input.start_date, end)
  const rec = newRecord({ text, start_date: input.start_date, end_date: end, done: false, pinned: false, order: await nextOrder(db) }) as NoticeItemRec
  await db.notice_items.add(rec)
  return rec
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
  return save(db.notice_items, next)
}

/** 지우고 되돌리기 함수를 돌려준다. */
export async function deleteNotice(db: AppDB, id: string): Promise<() => Promise<void>> {
  const before = await scrubDelete(db.notice_items, id, { text: '' })
  return async () => {
    if (before) await save(db.notice_items, { ...before, deleted: false })
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
