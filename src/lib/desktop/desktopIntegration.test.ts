// @vitest-environment node
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const D = require('../../../electron/desktopIntegration.cjs') as {
  exePath: (env: Record<string, string | undefined>, app: { getPath(n: string): string }) => string
  syncAutostart: (o: { get: () => { openAtLogin: boolean; executableWillLaunchAtLogin?: boolean; path?: string }; set: (s: { openAtLogin: boolean; path: string }) => void; exe: string }) => boolean
  shortcutTarget: (desktopDir: string) => string
  asBool: (v: unknown) => boolean
}
const app = { getPath: () => 'C:\\app\\Watson.exe' }

test('exePath는 PORTABLE_EXECUTABLE_FILE을 먼저 쓴다', () => {
  expect(D.exePath({ PORTABLE_EXECUTABLE_FILE: 'D:\\p\\Watson.exe' }, app)).toBe('D:\\p\\Watson.exe')
  expect(D.exePath({}, app)).toBe('C:\\app\\Watson.exe')
  expect(D.exePath({ PORTABLE_EXECUTABLE_FILE: '' }, app)).toBe('C:\\app\\Watson.exe')
})

test('syncAutostart: 켜져 있는데 경로가 다르면 다시 설정한다', () => {
  const calls: unknown[] = []
  const set = (s: unknown) => calls.push(s)
  expect(D.syncAutostart({ get: () => ({ openAtLogin: true, path: 'C:\\old\\Watson.exe' }), set, exe: 'D:\\new\\Watson.exe' })).toBe(true)
  expect(calls).toEqual([{ openAtLogin: true, path: 'D:\\new\\Watson.exe' }])
  expect(D.syncAutostart({ get: () => ({ openAtLogin: true, path: 'D:\\new\\Watson.exe' }), set, exe: 'D:\\new\\Watson.exe' })).toBe(false)
  expect(D.syncAutostart({ get: () => ({ openAtLogin: false, path: 'C:\\old' }), set, exe: 'D:\\new\\Watson.exe' })).toBe(false)
  expect(calls).toHaveLength(1)
})

test('shortcutTarget은 바탕화면의 Watson.lnk, asBool은 불리언만 받는다', () => {
  expect(D.shortcutTarget('/d')).toBe(path.join('/d', 'Watson.lnk'))
  expect(D.asBool(true)).toBe(true)
  expect(() => D.asBool('yes')).toThrow()
})
