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

test('네트워크 경로(UNC)는 열지 않는다', async () => {
  await expect(assertDir('\\\\server\\share\\자료')).rejects.toThrow('네트워크 폴더는 연결할 수 없습니다.')
  await expect(assertDir('//server/share')).rejects.toThrow('네트워크 폴더는 연결할 수 없습니다.')
})

test('localPathKind: Windows는 드라이브 문자 경로만, \\\\?\\·\\??\\·UNC·상대 경로는 거부', () => {
  const { isLocalPath } = require('../../../electron/folders.cjs') as { isLocalPath: (p: unknown, platform: string) => boolean }
  expect(isLocalPath('C:\\녹음\\a.mp3', 'win32')).toBe(true)
  expect(isLocalPath('d:/x/y', 'win32')).toBe(true)
  for (const bad of ['\\\\server\\share\\a', '//server/share', '\\??\\UNC\\host\\s\\a.wav', '\\\\?\\C:\\a', '\\??\\C:\\a', 'a.wav', '..\\a', '\\a.wav', 'C:a.wav', 3])
    expect([bad, isLocalPath(bad, 'win32')]).toEqual([bad, false])
  expect(isLocalPath('/home/a', 'linux')).toBe(true)
  expect(isLocalPath('//h/s', 'linux')).toBe(false)
  expect(isLocalPath('a', 'linux')).toBe(false)
})
