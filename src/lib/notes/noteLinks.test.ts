import { linksFromParts, parseNoteParts } from './noteLinks'

const notes = [
  { id: 'a', title: '회의록' },
  { id: 'b', title: '회의록 11월' },
]

test('parseNoteParts: 있는 노트 제목만, 긴 제목 먼저', () => {
  expect(parseNoteParts('보기 @회의록 11월 끝', notes)).toEqual(['보기 ', { note: 'b' }, ' 끝'])
  expect(parseNoteParts('@회의록', notes)).toEqual([{ note: 'a' }])
  expect(parseNoteParts('메일 a@b.com', notes)).toBeUndefined()
})

test('linksFromParts: 글 안 위치로', () => {
  const t = '보기 @회의록 11월 끝'
  const title = (id: string) => notes.find((n) => n.id === id)?.title
  expect(linksFromParts(t, parseNoteParts(t, notes), title)).toEqual([{ from: 3, to: 11, note: 'b' }])
  expect(linksFromParts(t, undefined, title)).toEqual([])
})

test('mentionAt·matchNotes', async () => {
  const { mentionAt, matchNotes } = await import('./noteLinks')
  expect(mentionAt('보기 @회의', 6)).toEqual({ start: 3, q: '회의' })
  expect(mentionAt('a@b', 3)).toBeNull()
  expect(mentionAt('@', 1)).toEqual({ start: 0, q: '' })
  expect(matchNotes(notes, '11월').map((n) => n.id)).toEqual(['b'])
  expect(matchNotes(notes, '', 'a').map((n) => n.id)).toEqual(['b'])
})
