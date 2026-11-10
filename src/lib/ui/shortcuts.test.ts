import { expect, test } from 'vitest'
import { matchShortcut, SHORTCUT_TABLE } from './shortcuts'

const k = (key: string, o: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; isComposing: boolean; code: string }> = {}) => ({
  key, code: o.code ?? '', ctrlKey: !!o.ctrlKey, altKey: !!o.altKey, shiftKey: !!o.shiftKey, metaKey: !!o.metaKey, isComposing: !!o.isComposing,
})

test('Ctrl+숫자는 메뉴 이동', () => {
  expect(matchShortcut(k('2', { ctrlKey: true }), false)).toEqual({ kind: 'nav', to: '/calendar' })
  expect(matchShortcut(k('6', { ctrlKey: true }), false)).toEqual({ kind: 'nav', to: '/settings' })
  expect(matchShortcut(k('1', { ctrlKey: true }), false)).toEqual({ kind: 'nav', to: '/' })
})

test('Alt+방향키는 앞뒤, 그 밖의 조합', () => {
  expect(matchShortcut(k('ArrowRight', { altKey: true }), false)).toEqual({ kind: 'step', dir: 1 })
  expect(matchShortcut(k('ArrowLeft', { altKey: true }), false)).toEqual({ kind: 'step', dir: -1 })
  expect(matchShortcut(k('H', { ctrlKey: true, shiftKey: true, code: 'KeyH' }), false)).toEqual({ kind: 'hideNames' })
  expect(matchShortcut(k('k', { ctrlKey: true, code: 'KeyK' }), false)).toEqual({ kind: 'command' })
  expect(matchShortcut(k('e', { ctrlKey: true, code: 'KeyE' }), false)).toEqual({ kind: 'export' })
  expect(matchShortcut(k('Escape'), false)).toEqual({ kind: 'close' })
})

test('한글 자판 상태에서도 Ctrl+K는 키 위치로 알아듣는다', () => {
  expect(matchShortcut(k('ㅏ', { ctrlKey: true, code: 'KeyK' }), false)).toEqual({ kind: 'command' })
})

test('글자 칸에서는 Ctrl/Alt 조합만, 한글 조합 중에는 아무것도', () => {
  expect(matchShortcut(k('2'), true)).toBeNull()
  expect(matchShortcut(k('2', { ctrlKey: true }), true)).toEqual({ kind: 'nav', to: '/calendar' })
  expect(matchShortcut(k('2', { ctrlKey: true, isComposing: true }), true)).toBeNull()
  expect(matchShortcut(k('a'), false)).toBeNull()
})

test('설정 화면용 단축키 표는 7줄', () => {
  expect(SHORTCUT_TABLE).toHaveLength(7)
})
