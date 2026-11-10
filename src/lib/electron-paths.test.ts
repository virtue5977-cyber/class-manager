import { expect, test } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { pickUserDataDir } = require('../../electron/paths.cjs') as { pickUserDataDir: (appData: string, exists: (p: string) => boolean) => string }

test('옛 담임업무 폴더가 있으면 그 폴더를 쓴다(새 exe에서도 자료 유지)', () => {
  expect(pickUserDataDir('/A', (p) => p === '/A/담임업무')).toBe('/A/담임업무')
})

test('옛 폴더가 없으면(새 설치) Watson 폴더', () => {
  expect(pickUserDataDir('/A', () => false)).toBe('/A/Watson')
})
