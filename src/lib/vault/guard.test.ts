import { newerDataPresent } from './guard'

test('watson- DB가 있으면 참', async () =>
  expect(await newerDataPresent(async () => [{ name: 'class-manager' }, { name: 'watson-1a2b3c4d' }])).toBe(true))

test('없으면 거짓, databases()가 없거나 실패해도 거짓', async () => {
  expect(await newerDataPresent(async () => [{ name: 'class-manager' }])).toBe(false)
  expect(await newerDataPresent(async () => { throw new Error('x') })).toBe(false)
})
