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

describe('fixOldShortcuts(0.13 바로가기를 지금 exe로)', () => {
  const F = require('../../../electron/desktopIntegration.cjs') as {
    fixOldShortcuts: (o: { read: (p: string) => { target?: string }; write: (p: string, op: string, d: { target: string; cwd: string }) => boolean; exists: (p: string) => boolean; exe: string; paths: string[] }) => { fixed: number; failed: number }
    oldShortcutPaths: (o: { appData: string; desktop: string }) => string[]
  }
  const exe = 'D:\\새폴더\\Watson.exe'
  function env(links: Record<string, string>) {
    const writes: { p: string; op: string; d: unknown }[] = []
    return {
      writes,
      read: (p: string) => { if (!(p in links)) throw new Error('없음'); return { target: links[p] } },
      write: (p: string, op: string, d: { target: string; cwd: string }) => { writes.push({ p, op, d }); return true },
      exists: (p: string) => p in links,
    }
  }

  test('경로: 시작프로그램 폴더와 바탕화면의 Watson.lnk', () => {
    expect(F.oldShortcutPaths({ appData: 'C:\\Users\\가상\\AppData\\Roaming', desktop: 'C:\\Users\\가상\\Desktop' })).toEqual([
      'C:\\Users\\가상\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Watson.lnk',
      'C:\\Users\\가상\\Desktop\\Watson.lnk',
    ])
  })

  test('옛 Watson exe를 가리키면 지금 exe로 바꿔 쓴다(replace, cwd = exe 폴더)', () => {
    const paths = ['S\\Watson.lnk', 'D\\Watson.lnk']
    const e = env({ 'S\\Watson.lnk': 'C:\\옛폴더\\Watson-0.13.0.exe', 'D\\Watson.lnk': 'C:\\옛폴더\\watson.EXE' })
    expect(F.fixOldShortcuts({ ...e, exe, paths })).toEqual({ fixed: 2, failed: 0 })
    expect(e.writes).toEqual([
      { p: 'S\\Watson.lnk', op: 'replace', d: { target: exe, cwd: 'D:\\새폴더' } },
      { p: 'D\\Watson.lnk', op: 'replace', d: { target: exe, cwd: 'D:\\새폴더' } },
    ])
  })

  test('이미 지금 exe(대소문자 무시)·Watson exe가 아닌 대상·없는 파일·읽기 실패는 건드리지 않는다', () => {
    const paths = ['a.lnk', 'b.lnk', 'c.lnk', 'd.lnk', 'e.lnk']
    const e = env({ 'a.lnk': 'd:\\새폴더\\watson.exe', 'b.lnk': 'C:\\Windows\\notepad.exe', 'c.lnk': 'C:\\x\\Watson.txt', 'e.lnk': '' })
    expect(F.fixOldShortcuts({ ...e, exe, paths })).toEqual({ fixed: 0, failed: 0 })
    expect(e.writes).toEqual([])
  })

  test('쓰기 실패는 세고 계속한다(던지지 않음)', () => {
    const e = env({ 'a.lnk': 'C:\\old\\Watson.exe', 'b.lnk': 'C:\\old2\\Watson.exe' })
    let n = 0
    const write = () => { n++; if (n === 1) throw new Error('잠김'); return true }
    expect(F.fixOldShortcuts({ ...e, write, exe, paths: ['a.lnk', 'b.lnk'] })).toEqual({ fixed: 1, failed: 1 })
  })
})
