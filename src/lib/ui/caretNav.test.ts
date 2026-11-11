import { caretNav, placeCaret } from './caretNav'

const k = (key: string, value: string, s: number, e = s, extra: Partial<{ shiftKey: boolean; isComposing: boolean }> = {}) => caretNav({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...extra }, { value, selectionStart: s, selectionEnd: e })

test('↑는 첫 줄에서만 위 칸으로(열 위치를 가지고), ↓는 마지막 줄에서만', () => {
  expect(k('ArrowUp', 'abc', 2)).toEqual({ dir: -1, col: 2 })
  expect(k('ArrowUp', 'ab\ncd', 4)).toBeNull()
  expect(k('ArrowDown', 'ab\ncd', 1)).toBeNull()
  expect(k('ArrowDown', 'ab\ncd', 4)).toEqual({ dir: 1, col: 1 })
})

test('←는 맨 앞에서 위 칸 끝으로, →는 맨 끝에서 아래 칸 앞으로', () => {
  expect(k('ArrowLeft', 'abc', 0)).toEqual({ dir: -1, col: 'end' })
  expect(k('ArrowLeft', 'abc', 1)).toBeNull()
  expect(k('ArrowRight', 'abc', 3)).toEqual({ dir: 1, col: 'start' })
  expect(k('ArrowRight', 'abc', 2)).toBeNull()
})

test('글자를 고른 상태·Shift·한글 조합 중에는 옮기지 않는다', () => {
  expect(k('ArrowUp', 'abc', 0, 2)).toBeNull()
  expect(k('ArrowLeft', 'abc', 0, 0, { shiftKey: true })).toBeNull()
  expect(k('ArrowDown', 'abc', 3, 3, { isComposing: true })).toBeNull()
})

test('옮겨 간 칸의 커서: 위로 가면 그 칸 마지막 줄의 같은 열, 아래로 가면 첫 줄의 같은 열(넘치면 줄 끝)', () => {
  expect(placeCaret('hello\nwo', { dir: -1, col: 1 })).toBe(7)
  expect(placeCaret('hello\nwo', { dir: -1, col: 9 })).toBe(8)
  expect(placeCaret('hi\nthere', { dir: 1, col: 5 })).toBe(2)
  expect(placeCaret('abc', { dir: -1, col: 'end' })).toBe(3)
  expect(placeCaret('abc', { dir: 1, col: 'start' })).toBe(0)
})
