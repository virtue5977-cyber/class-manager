// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { assertDir, listDir, pdfPageSize } = require('../../../electron/folders.cjs') as {
  assertDir: (p: unknown) => Promise<string>
  listDir: (p: string) => Promise<{ name: string; dir: boolean }[]>
  pdfPageSize: (o?: { pageSize?: string }) => unknown
}

test('폴더 목록은 디렉터리만, 폴더 먼저·숨김 제외', async () => {
  const d = mkdtempSync(join(tmpdir(), 'w-'))
  mkdirSync(join(d, '자료'))
  writeFileSync(join(d, '공문.hwpx'), 'x')
  writeFileSync(join(d, '.hidden'), 'x')
  expect(await listDir(d)).toEqual([{ name: '자료', dir: true }, { name: '공문.hwpx', dir: false }])
  await expect(listDir(join(d, '공문.hwpx'))).rejects.toThrow('폴더를 찾지 못했습니다.')
  await expect(assertDir('상대/경로')).rejects.toThrow('폴더를 찾지 못했습니다.')
})

test('PDF 용지: B4는 257×364mm', () => {
  expect(pdfPageSize()).toBe('A4')
  expect(pdfPageSize({ pageSize: 'B4' })).toEqual({ width: 257 / 25.4, height: 364 / 25.4 })
})
