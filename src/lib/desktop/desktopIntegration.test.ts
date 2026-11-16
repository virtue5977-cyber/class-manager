// @vitest-environment node
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const D = require('../../../electron/desktopIntegration.cjs') as {
  exePath: (env: Record<string, string | undefined>, app: { getPath(n: string): string }) => string
  syncAutostart: (o: { get: (p: string) => unknown; set: (s: { openAtLogin: boolean; path: string }) => void; exe: string; last?: string; save?: (p: string) => void }) => boolean
  usable: (app: { isPackaged: boolean }, env: Record<string, string | undefined>) => boolean
  DEV_MSG: string
  shortcutTarget: (desktopDir: string) => string
  asBool: (v: unknown) => boolean
}
const app = { getPath: () => 'C:\\app\\Watson.exe' }

test('exePath는 PORTABLE_EXECUTABLE_FILE을 먼저 쓴다', () => {
  expect(D.exePath({ PORTABLE_EXECUTABLE_FILE: 'D:\\p\\Watson.exe' }, app)).toBe('D:\\p\\Watson.exe')
  expect(D.exePath({}, app)).toBe('C:\\app\\Watson.exe')
  expect(D.exePath({ PORTABLE_EXECUTABLE_FILE: '' }, app)).toBe('C:\\app\\Watson.exe')
})

type LI = { openAtLogin?: boolean; executableWillLaunchAtLogin?: boolean; launchItems?: { name: string; path: string; args: string[]; scope: string; enabled: boolean }[] }
const item = (p: string, enabled = true) => ({ name: 'Watson', path: p, args: [], scope: 'user', enabled })
const mk = (table: Record<string, LI>) => ({ get: (p: string) => table[p.toLowerCase()] ?? { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] } })

test('syncAutostart: launchItems의 옛 경로를 지금 exe로 옮긴다', () => {
  const calls: unknown[] = []
  const saved: string[] = []
  const exe = 'D:\\new\\Watson.exe'
  const old = 'C:\\old\\Watson.exe'
  const { get } = mk({ [exe.toLowerCase()]: { openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [item(old)] } })
  expect(D.syncAutostart({ get, set: (s: unknown) => calls.push(s), exe, save: (p: string) => saved.push(p) } as never)).toBe(true)
  expect(calls).toEqual([{ openAtLogin: false, path: old }, { openAtLogin: true, path: exe }]) // 끄기 먼저, 켜기 나중(이름으로 기억하므로)
  expect(saved).toEqual([exe])
})

test('syncAutostart: launchItems에 없어도 마지막 등록 경로로 지운다', () => {
  const calls: unknown[] = []
  const exe = 'D:\\new\\Watson.exe'
  const old = 'C:\\old\\Watson.exe'
  const { get } = mk({ [old.toLowerCase()]: { openAtLogin: true, executableWillLaunchAtLogin: true } })
  expect(D.syncAutostart({ get, set: (s: unknown) => calls.push(s), exe, last: old } as never)).toBe(true)
  expect(calls).toEqual([{ openAtLogin: false, path: old }, { openAtLogin: true, path: exe }]) // 끄기 먼저, 켜기 나중(이름으로 기억하므로)
})

test('syncAutostart: 이미 지금 경로면, 꺼져 있으면 아무것도 하지 않는다', () => {
  const calls: unknown[] = []
  const exe = 'D:\\new\\Watson.exe'
  const on = mk({ [exe.toLowerCase()]: { openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [item(exe)] } })
  expect(D.syncAutostart({ get: on.get, set: (s: unknown) => calls.push(s), exe, last: exe } as never)).toBe(false)
  expect(D.syncAutostart({ get: mk({}).get, set: (s: unknown) => calls.push(s), exe, last: 'C:\\x\\Watson.exe' } as never)).toBe(false)
  expect(calls).toEqual([])
})

test('usable: 패키지·portable일 때만', () => {
  expect(D.usable({ isPackaged: false }, {})).toBe(false)
  expect(D.usable({ isPackaged: true }, {})).toBe(true)
  expect(D.usable({ isPackaged: false }, { PORTABLE_EXECUTABLE_FILE: 'x' })).toBe(true)
  expect(D.DEV_MSG).toBe('개발용 실행에서는 쓸 수 없습니다')
})

test('shortcutTarget은 바탕화면의 Watson.lnk, asBool은 불리언만 받는다', () => {
  expect(D.shortcutTarget('/d')).toBe(path.join('/d', 'Watson.lnk'))
  expect(D.asBool(true)).toBe(true)
  expect(() => D.asBool('yes')).toThrow()
})
