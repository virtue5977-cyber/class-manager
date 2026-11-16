// @vitest-environment node
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sec = require('../../../electron/security.cjs') as {
  CSP: string
  permissionAllowed: (p: string) => boolean
  createPathRoots: (o?: { platform?: string; roots?: string[] }) => {
    addRoot(dir: string): boolean
    addFile(p: string): boolean
    allowDir(p: unknown): boolean
    allowFile(p: unknown): boolean
    roots(): string[]
  }
}
const agy = require('../../../electron/agy.cjs') as {
  agyArgs: (p: string) => string[]
  agyFileArgs: (name: string) => string[]
  needFileFallback: (r: { text?: string; error?: string }) => boolean
  resolveAbs: (name: string, o: { platform: string; cwd: string; run: (cmd: string, args: string[]) => string; exists: (p: string) => boolean }) => { file: string; viaCmd: boolean } | null
  claudeAskArgs: (platform: string) => string[]
  LOGIN_MSG: string
}
const fuses = require('../../../scripts/fuses.cjs') as ((ctx: unknown, deps?: unknown) => Promise<void>) & { afterPack: (ctx: unknown, deps?: unknown) => Promise<void> }

describe('CSP', () => {
  test('raw.githubusercontent.com이 없고 form-action·frame-src·object-src가 none', () => {
    expect(sec.CSP).not.toContain('raw.githubusercontent.com')
    expect(sec.CSP).toContain("form-action 'none'")
    expect(sec.CSP).toContain("frame-src 'none'")
    expect(sec.CSP).toContain("object-src 'none'")
    expect(sec.CSP).not.toContain('www.googleapis.com')
  })
  test('화면이 부르는 바깥 주소는 AI 두 곳과 NEIS뿐', () => {
    const connect = sec.CSP.split(';').map((s) => s.trim()).find((s) => s.startsWith('connect-src'))!
    expect(connect.split(/\s+/).slice(1)).toEqual(["'self'", 'https://api.anthropic.com', 'https://generativelanguage.googleapis.com', 'https://open.neis.go.kr'])
  })
})

describe('권한', () => {
  test('clipboard-sanitized-write만 허용', () => {
    expect(sec.permissionAllowed('clipboard-sanitized-write')).toBe(true)
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'fullscreen', 'openExternal', 'fileSystem', 'unknown', ''])
      expect([p, sec.permissionAllowed(p)]).toEqual([p, false])
  })
})

describe('경로 통로', () => {
  test('Windows: 루트 안은 참, ..·다른 드라이브·UNC·상대 경로는 거짓', () => {
    const r = sec.createPathRoots({ platform: 'win32' })
    expect(r.addRoot('C:\\학급\\자료')).toBe(true)
    expect(r.allowDir('C:\\학급\\자료')).toBe(true)
    expect(r.allowDir('C:\\학급\\자료\\1학기')).toBe(true)
    expect(r.allowDir('c:/학급/자료/1학기/')).toBe(true) // 대소문자·구분자 무시
    expect(r.allowDir('C:\\학급\\자료\\..\\비밀')).toBe(false)
    expect(r.allowDir('C:\\학급\\자료\\..')).toBe(false)
    expect(r.allowDir('C:\\학급\\자료2')).toBe(false) // 이름 앞부분만 같은 형제 폴더
    expect(r.allowDir('C:\\학급')).toBe(false)
    expect(r.allowDir('D:\\학급\\자료')).toBe(false)
    expect(r.allowDir('\\\\server\\share\\학급\\자료')).toBe(false)
    expect(r.allowDir('학급\\자료')).toBe(false)
    expect(r.allowDir(3)).toBe(false)
    expect(r.addRoot('\\\\server\\share')).toBe(false)
    expect(r.addRoot('상대')).toBe(false)
  })
  test('파일: 등록 안 한 파일은 거짓, 등록한 drop 파일은 참(루트 안이라도 파일은 따로 등록)', () => {
    const r = sec.createPathRoots({ platform: 'win32' })
    r.addRoot('C:\\녹음')
    expect(r.allowFile('C:\\녹음\\a.mp3')).toBe(false)
    expect(r.addFile('C:\\Users\\t\\Desktop\\상담.mp3')).toBe(true)
    expect(r.allowFile('C:\\Users\\t\\Desktop\\상담.mp3')).toBe(true)
    expect(r.allowFile('c:\\users\\t\\desktop\\상담.MP3')).toBe(true)
    expect(r.allowFile('C:\\Users\\t\\Desktop\\..\\Desktop\\상담.mp3')).toBe(false)
    expect(r.allowFile('C:\\Users\\t\\Desktop\\다른.mp3')).toBe(false)
    expect(r.addFile('\\\\server\\s\\a.mp3')).toBe(false)
  })
  test('posix: 루트 안만, 저장한 루트로 다시 만든다', () => {
    const r = sec.createPathRoots({ platform: 'linux', roots: ['/home/t/자료', 'relative', '//x'] })
    expect(r.roots()).toEqual(['/home/t/자료'])
    expect(r.allowDir('/home/t/자료/a')).toBe(true)
    expect(r.allowDir('/home/t/자료/../b')).toBe(false)
    expect(r.allowDir('/home/t/자료b')).toBe(false)
    expect(r.allowDir('/home/t/Docs')).toBe(false)
  })
})

describe('외부 프로그램', () => {
  test('agyArgs 결과에 프롬프트 글이 없다(표준 입력으로 보냄)', () => {
    const prompt = '김학생 상담 메모: 출석률 95%'
    const a = agy.agyArgs(prompt)
    expect(a.join(' ')).not.toContain('김학생')
    expect(a.some((x) => x.includes(prompt))).toBe(false)
    expect(a).toEqual(expect.arrayContaining(['--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands']))
    expect(() => agy.agyArgs('가'.repeat(20001))).toThrow('AI에 보낼 글이 너무 깁니다')
  })
  test('표준 입력을 못 읽는 판의 대체: 파일 이름만 인자로, 로그인 오류에서는 대체하지 않는다', () => {
    const a = agy.agyFileArgs('prompt-ab12.txt')
    expect(a.join(' ')).toContain('prompt-ab12.txt')
    expect(a).toEqual(expect.arrayContaining(['--mode', 'plan', '--sandbox']))
    expect(agy.needFileFallback({ error: 'Antigravity 응답이 없습니다.' })).toBe(true)
    expect(agy.needFileFallback({ error: 'Antigravity 응답을 읽지 못했습니다.' })).toBe(true)
    expect(agy.needFileFallback({ error: agy.LOGIN_MSG })).toBe(false)
    expect(agy.needFileFallback({ text: '답' })).toBe(false)
  })
  test('Claude Code 인자에도 프롬프트가 없고 --tools 빈 값은 그대로 빈 글', () => {
    for (const pf of ['win32', 'linux']) {
      const a = agy.claudeAskArgs(pf)
      expect(a[a.indexOf('--tools') + 1]).toBe('')
    }
  })
  test('resolveAbs: where 결과의 절대 경로만, 상대 경로·cwd 안 파일·없는 파일은 받지 않는다', () => {
    const cwd = 'C:\\Users\\t\\AppData\\Roaming\\담임업무\\ai-work'
    const exists = (p: string) => !p.includes('없음')
    const run = (out: string) => () => out
    const W = (out: string) => agy.resolveAbs('agy', { platform: 'win32', cwd, run: run(out), exists })
    expect(W('C:\\npm\\agy\r\nC:\\npm\\agy.cmd\r\n')).toEqual({ file: 'C:\\npm\\agy.cmd', viaCmd: true })
    expect(W('C:\\bin\\agy.exe\r\n')).toEqual({ file: 'C:\\bin\\agy.exe', viaCmd: false })
    expect(W('agy.exe\r\n')).toBeNull()
    expect(W('.\\agy.exe\r\n')).toBeNull()
    expect(W(`${cwd}\\agy.exe\r\n`)).toBeNull()
    expect(W(`${cwd}\\agy.exe\r\nC:\\bin\\agy.exe\r\n`)).toEqual({ file: 'C:\\bin\\agy.exe', viaCmd: false })
    expect(W('C:\\없음\\agy.exe\r\n')).toBeNull()
    expect(W('\\\\server\\s\\agy.exe\r\n')).toBeNull()
    expect(W('')).toBeNull()
    expect(agy.resolveAbs('agy', { platform: 'win32', cwd, run: () => { throw new Error('INFO: not found') }, exists })).toBeNull()
    const P = (out: string) => agy.resolveAbs('claude', { platform: 'linux', cwd: '/home/t/.config/w/ai-work', run: run(out), exists })
    expect(P('/usr/local/bin/claude\n')).toEqual({ file: '/usr/local/bin/claude', viaCmd: false })
    expect(P('claude\n')).toBeNull()
    expect(P('/home/t/.config/w/ai-work/claude\n')).toBeNull()
  })
  test('resolveAbs는 where/which를 이름 하나로만 부른다', () => {
    const calls: [string, string[]][] = []
    agy.resolveAbs('claude', { platform: 'win32', cwd: 'C:\\w', run: (c, a) => (calls.push([c, a]), ''), exists: () => true })
    agy.resolveAbs('claude', { platform: 'darwin', cwd: '/w', run: (c, a) => (calls.push([c, a]), ''), exists: () => true })
    expect(calls).toEqual([['where', ['claude']], ['which', ['claude']]])
  })
})

describe('fuses afterPack', () => {
  test('win32: <appOutDir>/<productFilename>.exe에 정해진 fuse만 건다(asar 무결성은 건드리지 않음)', async () => {
    const calls: [string, Record<string | number, unknown>][] = []
    const flipFuses = async (file: string, cfg: Record<string | number, unknown>) => void calls.push([file, cfg])
    const ctx = { electronPlatformName: 'win32', appOutDir: path.join('release', 'win-unpacked'), packager: { appInfo: { productFilename: 'Watson' } } }
    await fuses(ctx, { flipFuses })
    expect(fuses.afterPack).toBe(fuses)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(path.join('release', 'win-unpacked', 'Watson.exe'))
    const { FuseV1Options, FuseVersion } = (await import('@electron/fuses')) as unknown as { FuseV1Options: Record<string, number>; FuseVersion: Record<string, string> }
    expect(calls[0][1]).toEqual({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    })
    expect(Object.keys(calls[0][1])).not.toContain(String(FuseV1Options.EnableEmbeddedAsarIntegrityValidation))
    expect(Object.keys(calls[0][1])).not.toContain(String(FuseV1Options.OnlyLoadAppFromAsar))
  })
  test('Windows가 아니면 아무것도 하지 않는다', async () => {
    let n = 0
    await fuses({ electronPlatformName: 'linux', appOutDir: 'x', packager: { appInfo: { productFilename: 'Watson' } } }, { flipFuses: async () => void n++ })
    expect(n).toBe(0)
  })
  test('package.json build.afterPack이 이 파일을 가리키고 @electron/fuses가 정확한 판으로 있다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'))
    expect(pkg.build.afterPack).toBe('scripts/fuses.cjs')
    expect(pkg.devDependencies['@electron/fuses']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('preload 경로 등록', () => {
  test('preload는 경로 문자열이 아니라 File에서 얻은 경로만 등록한다', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../electron/preload.cjs'), 'utf8')
    expect(src).toMatch(/registerDrop[^\n]*webUtils\.getPathForFile\(file\)/)
    expect(src).toContain("'paths:pick-folder'")
  })
})
