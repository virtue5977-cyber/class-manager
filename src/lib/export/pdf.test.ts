import { afterEach, expect, test, vi } from 'vitest'
import { exportPdf } from './pdf'

afterEach(() => {
  delete (globalThis as { desktop?: unknown }).desktop
  vi.restoreAllMocks()
})

test('브리지가 없으면(HTML판·옛 exe) 인쇄 창으로 대신한다', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  expect(await exportPdf('통계_2026-11.pdf')).toBe('printed')
  expect(print).toHaveBeenCalled()
})

test('브리지가 있으면 그 이름으로 바로 저장한다', async () => {
  const save = vi.fn(async () => true)
  ;(globalThis as { desktop?: unknown }).desktop = { pdf: { save } }
  expect(await exportPdf('통계_2026-11.pdf')).toBe('saved')
  expect(save).toHaveBeenCalledWith('통계_2026-11.pdf')
})

test('저장 창에서 취소하면 canceled', async () => {
  ;(globalThis as { desktop?: unknown }).desktop = { pdf: { save: async () => false } }
  expect(await exportPdf('a.pdf')).toBe('canceled')
})
