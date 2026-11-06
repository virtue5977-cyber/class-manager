// @vitest-environment node
import { isNewer, checkHtmlUpdate } from './update'

test('버전 비교·HTML 업데이트 확인', async () => {
  expect(isNewer('0.2.10', '0.2.9')).toBe(true)
  expect(isNewer('0.2.0', '0.2.0')).toBe(false)
  expect(isNewer('1.0', '0.9.9')).toBe(true)
  expect(await checkHtmlUpdate(async () => ({ version: '0.3.0', note: '달력' }), '0.2.0')).toEqual({ status: 'html-available', current: '0.2.0', version: '0.3.0', note: '달력' })
  expect((await checkHtmlUpdate(async () => ({ version: '0.2.0' }), '0.2.0')).status).toBe('latest')
  expect((await checkHtmlUpdate(async () => { throw new Error('x') }, '0.2.0')).status).toBe('error')
})
