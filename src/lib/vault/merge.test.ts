import { newerWins } from './merge'

test('newerWins: updated_at이 큰 쪽, 같으면 a', () => {
  const a = { updated_at: '2026-01-01T00:00:00.000Z' }
  const b = { updated_at: '2026-02-01T00:00:00.000Z' }
  expect(newerWins(a, b)).toBe(b)
  expect(newerWins(b, a)).toBe(b)
  expect(newerWins(a, { ...a })).toBe(a)
})
