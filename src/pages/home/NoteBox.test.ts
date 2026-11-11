import { recentNotes } from './NoteBox'
import type { NoteRec } from '../../lib/db/types'

test('홈 노트함은 끌어서 정한 순서와 상관없이 고정 → 최근에 고친 순 10개', () => {
  const n = (title: string, updated_at: string, extra: Partial<NoteRec> = {}) => ({ id: title, title, updated_at, pinned: false, blocks: [], ...extra }) as unknown as NoteRec
  const list = [n('옛것', '2026-11-01', { order: 0 }), n('오늘', '2026-11-11', { order: 5 }), n('고정', '2026-10-01', { pinned: true }), ...Array.from({ length: 12 }, (_, i) => n(`x${i}`, `2026-09-${String(i + 10)}`))]
  const r = recentNotes(list)
  expect(r.map((x) => x.title).slice(0, 3)).toEqual(['고정', '오늘', '옛것'])
  expect(r).toHaveLength(10)
})
