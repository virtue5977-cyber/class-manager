// @vitest-environment node
import { isNewer } from './update'

test('버전 비교', () => {
  expect(isNewer('0.2.10', '0.2.9')).toBe(true)
  expect(isNewer('0.2.0', '0.2.0')).toBe(false)
  expect(isNewer('1.0', '0.9.9')).toBe(true)
})

test('HTML판 업데이트 받기 경로는 없다(서명 없는 파일을 받지 않게)', async () => {
  const mod = (await import('./update')) as Record<string, unknown>
  expect(mod.checkHtmlUpdate).toBeUndefined()
  expect(mod.fetchNewHtml).toBeUndefined()
})
