// @vitest-environment node
import { expect, test } from 'vitest'
import { loadPreload } from '../../test/loadPreload'

test('preload는 sandbox 조건(electron만 require)에서 실패 없이 desktop API를 내놓는다', () => {
  const exposed = loadPreload()
  const d = exposed.desktop as Record<string, unknown>
  expect(d).toBeTruthy()
  expect(d.shell).toBe(7)
  for (const k of ['vault', 'google', 'bundle', 'app', 'file', 'paths', 'autostart']) expect(d[k], k).toBeTruthy()
})
