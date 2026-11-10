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

test('용지 크기를 다리에 넘긴다(반성문 B4)', async () => {
  const calls: unknown[][] = []
  ;(globalThis as { desktop?: unknown }).desktop = { pdf: { sizes: ['A4', 'B4'], save: async (...a: unknown[]) => (calls.push(a), true) } }
  try {
    const { exportPdf } = await import('./pdf')
    expect(await exportPdf('반성문.pdf', { pageSize: 'B4' })).toBe('saved')
    expect(calls[0]).toEqual(['반성문.pdf', { pageSize: 'B4' }])
  } finally {
    delete (globalThis as { desktop?: unknown }).desktop
  }
})

test('옛 exe(용지 크기 모름)에서 B4를 고르면 인쇄 창으로(@page B4)', async () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  ;(globalThis as { desktop?: unknown }).desktop = { pdf: { save: async () => true } }
  try {
    const { exportPdf } = await import('./pdf')
    expect(await exportPdf('반성문.pdf', { pageSize: 'B4' })).toBe('printed')
    expect(print).toHaveBeenCalled()
  } finally {
    delete (globalThis as { desktop?: unknown }).desktop
    print.mockRestore()
  }
})
