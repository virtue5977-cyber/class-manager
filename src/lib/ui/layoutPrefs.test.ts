import { resetPrefs as resetCache, DEFAULT_MENU, DEFAULT_PANELS, mergeOrder, movePref, panelPlace, readPrefs, savePrefs, setPlace, togglePref } from './layoutPrefs'

beforeEach(() => localStorage.clear())

test('기본 메뉴 순서: 홈 · 달력 · 학급 · 출결 · 상담일지 · 노트함, 오른쪽 칸: 할 일·일정·노트·급식', () => {
  expect(DEFAULT_MENU).toEqual(['/', '/calendar', '/class/roster', '/attendance', '/counseling', '/notes'])
  expect(DEFAULT_PANELS).toEqual(['notice', 'todo', 'upcoming', 'notes', 'meal'])
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

test('칸 자리: 옛 저장값(자리 없음)은 모두 오른쪽, 높이는 없음', () => {
  localStorage.setItem('watson.layout', JSON.stringify({ panels: [{ key: 'notes', hidden: false }, { key: 'todo', hidden: true }] }))
  const p = readPrefs()
  expect(p.panels.map(panelPlace)).toEqual(['side', 'hidden', 'tab', 'side', 'side'])
  expect(p.panelH).toEqual({})
})

test('칸 자리 바꾸기(오른쪽 / 왼쪽 탭 / 숨김)와 높이가 저장되고 다시 읽힌다(높이는 120~900)', () => {
  let p = readPrefs()
  p = { ...p, panels: setPlace(setPlace(p.panels, 'notes', 'tab'), 'meal', 'hidden'), panelH: { todo: 50, upcoming: 300 } }
  expect(p.panels.map((x) => [x.key, panelPlace(x)])).toEqual([['notice', 'tab'], ['todo', 'side'], ['upcoming', 'side'], ['notes', 'tab'], ['meal', 'hidden']])
  savePrefs(p)
  const q = readPrefs()
  expect(q.panels.map(panelPlace)).toEqual(['tab', 'side', 'side', 'tab', 'hidden'])
  expect(q.panelH).toEqual({ todo: 120, upcoming: 300 })
  // 숨긴 칸을 다시 보이게 하면 전에 있던 자리가 아니라 고른 자리로
  expect(panelPlace(setPlace(q.panels, 'meal', 'tab').find((x) => x.key === 'meal')!)).toBe('tab')
})

test('전달사항 칸: 기본은 왼쪽 탭, 예전 저장값에 없으면 왼쪽 탭으로 생기고, 오른쪽으로 옮길 수 있다', () => {
  expect(DEFAULT_PANELS[0]).toBe('notice')
  expect(panelPlace(readPrefs().panels.find((x) => x.key === 'notice')!)).toBe('tab')
  localStorage.setItem('watson.layout', JSON.stringify({ panels: [{ key: 'todo', hidden: false }] }))
  resetCache()
  const p = readPrefs()
  expect(panelPlace(p.panels.find((x) => x.key === 'notice')!)).toBe('tab')
  savePrefs({ ...p, panels: setPlace(p.panels, 'notice', 'side') })
  expect(panelPlace(readPrefs().panels.find((x) => x.key === 'notice')!)).toBe('side')
})
