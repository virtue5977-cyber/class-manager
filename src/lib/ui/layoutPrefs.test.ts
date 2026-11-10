import { DEFAULT_MENU, DEFAULT_PANELS, mergeOrder, movePref, readPrefs, savePrefs, togglePref } from './layoutPrefs'

beforeEach(() => localStorage.clear())

test('기본 메뉴 순서: 홈 · 달력 · 학급 · 출결 · 상담일지 · 노트함, 오른쪽 칸: 할 일·일정·노트·급식', () => {
  expect(DEFAULT_MENU).toEqual(['/', '/calendar', '/class/roster', '/attendance', '/counseling', '/notes'])
  expect(DEFAULT_PANELS).toEqual(['todo', 'upcoming', 'notes', 'meal'])
  const p = readPrefs()
  expect(p.menu.map((m) => m.key)).toEqual(DEFAULT_MENU)
  expect(p.sidebarW).toBe(224)
})

test('저장값 합치기: 저장 순서·숨김, 새 항목은 끝에, 모르는 항목은 버림', () => {
  expect(mergeOrder([{ key: '/notes', hidden: true }, { key: '/zzz', hidden: false }], ['/', '/notes', '/calendar'])).toEqual([
    { key: '/notes', hidden: true },
    { key: '/', hidden: false },
    { key: '/calendar', hidden: false },
  ])
})

test('옮기기·숨기기(홈은 숨길 수 없음), 저장하면 다시 읽힌다', () => {
  let p = readPrefs()
  p = { ...p, menu: movePref(p.menu, '/notes', -1) }
  expect(p.menu.map((m) => m.key).slice(-2)).toEqual(['/notes', '/counseling'])
  p = { ...p, menu: togglePref(p.menu, '/', true), panels: togglePref(p.panels, 'meal', true) }
  expect(p.menu[0].hidden).toBe(false)
  expect(p.panels.find((x) => x.key === 'meal')!.hidden).toBe(true)
  savePrefs({ ...p, sidebarW: 999 })
  const q = readPrefs()
  expect(q.panels.find((x) => x.key === 'meal')!.hidden).toBe(true)
  expect(q.sidebarW).toBe(320) // 160~320
})
