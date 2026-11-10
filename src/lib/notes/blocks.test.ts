import type { NoteBlock } from '../db/types'
import { filterSlash, mergeUp, moveBlock, setType, splitBlock } from './blocks'

const B = (id: string, text: string, type: NoteBlock['type'] = 'p'): NoteBlock => ({ id, type, text })

test('나누기: 커서 뒤 글은 새 블록(목록이면 같은 종류)', () => {
  const r = splitBlock([B('a', '가나다라', 'check')], 'a', 2)
  expect(r.blocks.map((b) => [b.type, b.text])).toEqual([['check', '가나'], ['check', '다라']])
  expect(r.focusId).toBe(r.blocks[1].id)
  const h = splitBlock([B('a', '제목', 'h1')], 'a', 2)
  expect(h.blocks[1].type).toBe('p')
})

test('빈 목록 블록에서 Enter → 문단으로 바꿈(목록 끝내기)', () => {
  const r = splitBlock([B('a', '', 'bullet')], 'a', 0)
  expect(r.blocks.map((b) => b.type)).toEqual(['p'])
})

test('합치기: 위 블록 끝에 붙고 커서는 이어진 자리', () => {
  const r = mergeUp([B('a', '가나'), B('b', '다라')], 'b')
  expect(r.blocks.map((b) => b.text)).toEqual(['가나다라'])
  expect([r.focusId, r.caret]).toEqual(['a', 2])
  expect(mergeUp([B('a', 'x')], 'a').blocks).toHaveLength(1)
})

test('옮기기·종류 바꾸기', () => {
  const bs = [B('a', '1'), B('b', '2'), B('c', '3')]
  expect(moveBlock(bs, 'c', 0).map((b) => b.id)).toEqual(['c', 'a', 'b'])
  expect(setType(bs, 'b', 'check')[1]).toMatchObject({ type: 'check', checked: false })
})

test('/ 메뉴 거르기(한글 이름·초성)', () => {
  expect(filterSlash('체').map((i) => i.label)).toEqual(['체크 목록'])
  expect(filterSlash('ㅈㅁ').map((i) => i.label)).toContain('제목 1')
  expect(filterSlash('').length).toBe(9)
})
