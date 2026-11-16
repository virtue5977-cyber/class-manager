// @vitest-environment node
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sec = require('../../../electron/security.cjs') as {
  CSP: string
  permissionAllowed: (p: string) => boolean
  createPathRoots: (o?: { platform?: string; roots?: string[]; realpath?: (p: string) => string }) => {
    addRoot(dir: string): boolean
    addFile(p: string): boolean
    allowDir(p: unknown): boolean
    allowFile(p: unknown): boolean
    roots(): string[]
    knownDir(p: unknown): boolean
  }
}
const agy = require('../../../electron/agy.cjs') as {
  agyArgs: (p: string) => string[]
  agyStdinLine: (p: string) => string
  agyArgvArgs: (p: string) => string[]
  parseAgyStream: (out: string, err?: string) => { text?: string; error?: string }
  streamRejected: (r: { code: number | null; out: string; err: string }) => boolean
  probePrompt: (nonce: string) => string
  collectText: (stream: NodeJS.ReadableStream) => () => string
  statusFrom: (v: string, probe: { text?: string; error?: string }, nonce?: string) => { installed: boolean; loggedIn?: boolean; message?: string }
  cmdLine: (file: string, args: string[]) => string
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
    const r = sec.createPathRoots({ platform: 'win32', realpath: (p) => p })
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
    expect(r.addRoot('\\\\?\\C:\\a')).toBe(false)
    expect(r.addRoot('\\\\.\\PhysicalDrive0')).toBe(false)
    expect(r.addRoot('\\??\\C:\\a')).toBe(false)
    expect(r.addRoot('상대')).toBe(false)
  })
  test('파일: 등록 안 한 파일은 거짓, 등록한 drop 파일은 참(루트 안이라도 파일은 따로 등록)', () => {
    const r = sec.createPathRoots({ platform: 'win32', realpath: (p) => p })
    r.addRoot('C:\\녹음')
    expect(r.allowFile('C:\\녹음\\a.mp3')).toBe(false)
    expect(r.addFile('C:\\Users\\t\\Desktop\\상담.mp3')).toBe(true)
    expect(r.allowFile('C:\\Users\\t\\Desktop\\상담.mp3')).toBe(true)
    expect(r.allowFile('c:\\users\\t\\desktop\\상담.MP3')).toBe(true)
    expect(r.allowFile('C:\\Users\\t\\Desktop\\..\\Desktop\\상담.mp3')).toBe(false)
    expect(r.allowFile('C:\\Users\\t\\Desktop\\다른.mp3')).toBe(false)
    expect(r.allowFile('\\\\server\\s\\a.mp3')).toBe(false)
  })
  test('posix: 루트 안만, 저장한 루트로 다시 만든다', () => {
    const r = sec.createPathRoots({ platform: 'linux', roots: ['/home/t/자료', 'relative', '//x'], realpath: (p) => p })
    expect(r.roots()).toEqual(['/home/t/자료'])
    expect(r.allowDir('/home/t/자료/a')).toBe(true)
    expect(r.allowDir('/home/t/자료/../b')).toBe(false)
    expect(r.allowDir('/home/t/자료b')).toBe(false)
    expect(r.allowDir('/home/t/Docs')).toBe(false)
  })
  test('실제 경로(realpath)로 비교: 루트 안 링크가 밖을 가리키면 거짓, realpath 실패면 거짓', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'roots-')))
    const root = path.join(base, '자료')
    const outside = path.join(base, '비밀')
    fs.mkdirSync(path.join(root, '안'), { recursive: true })
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'a.mp3'), 'x')
    fs.symlinkSync(outside, path.join(root, '링크'), 'dir')
    const r = sec.createPathRoots({ platform: 'linux' })
    expect(r.addRoot(root)).toBe(true)
    expect(r.allowDir(path.join(root, '안'))).toBe(true)
    expect(r.allowDir(path.join(root, '링크'))).toBe(false)
    expect(r.allowDir(path.join(root, '없는 폴더'))).toBe(false)
    expect(r.addRoot(path.join(base, '없음'))).toBe(false)
    // 루트를 가리키는 링크로 등록해도 실제 경로로 기억한다
    fs.symlinkSync(root, path.join(base, '바로가기'), 'dir')
    const r2 = sec.createPathRoots({ platform: 'linux' })
    expect(r2.addRoot(path.join(base, '바로가기'))).toBe(true)
    expect(r2.roots()).toEqual([path.join(base, '바로가기')]) // 고른 표기로 저장(다시 켤 때 다시 풂)
    expect(r2.allowDir(path.join(root, '안'))).toBe(true)
    // 파일: 링크로 등록한 파일은 실제 파일 경로로 맞춘다
    fs.symlinkSync(path.join(outside, 'a.mp3'), path.join(base, 'b.mp3'))
    expect(r2.addFile(path.join(base, 'b.mp3'))).toBe(true)
    expect(r2.allowFile(path.join(outside, 'a.mp3'))).toBe(true)
    const bad = sec.createPathRoots({ platform: 'win32', realpath: () => { throw new Error('ENOENT') } })
    expect(bad.addRoot('C:\\자료')).toBe(false)
    expect(bad.addFile('C:\\a.mp3')).toBe(false)
    const r3 = sec.createPathRoots({ platform: 'win32', realpath: (p) => (p.includes('링크') ? 'D:\\밖' : p) })
    r3.addRoot('C:\\자료')
    expect(r3.allowDir('C:\\자료\\링크')).toBe(false)
    expect(r3.allowDir('C:\\자료\\안')).toBe(true)
  })
  test('네트워크 폴더(학교 NAS): 사용자가 고른 UNC·연결된 드라이브(Z:)도 허용, 실제 경로끼리 비교', () => {
    const r = sec.createPathRoots({ platform: 'win32', realpath: (p) => p })
    expect(r.addRoot('\\\\nas\\학급')).toBe(true)
    expect(r.allowDir('\\\\nas\\학급\\1학기')).toBe(true)
    expect(r.allowDir('\\\\NAS\\학급\\1학기')).toBe(true)
    expect(r.allowDir('\\\\nas\\다른')).toBe(false)
    expect(r.allowDir('\\\\nas\\학급\\..\\다른')).toBe(false)
    expect(r.allowDir('\\\\other\\학급\\1학기')).toBe(false)
    expect(r.addFile('\\\\nas\\녹음\\a.mp3')).toBe(true)
    expect(r.allowFile('\\\\nas\\녹음\\a.mp3')).toBe(true)
    // Z: 는 \\nas\share 로 풀린다
    const z = (p: string) => p.replace(/^Z:\\?/i, '\\\\nas\\share\\').replace(/\\$/, '')
    const m = sec.createPathRoots({ platform: 'win32', realpath: z })
    expect(m.addRoot('Z:\\')).toBe(true)
    expect(m.allowDir('Z:\\자료')).toBe(true)
    expect(m.allowDir('\\\\nas\\share\\자료')).toBe(true)
    expect(m.allowDir('C:\\자료')).toBe(false)
    // realpath 실패는 여전히 거부
    const bad = sec.createPathRoots({ platform: 'win32', realpath: () => { throw new Error('ENOENT') } })
    expect(bad.addRoot('\\\\nas\\학급')).toBe(false)
    // 화면이 보낸 임의의 서버 경로는 realpath(=그 서버 접속, 윈도 로그인 정보 전송)를 부르기 전에 글자로 거른다
    const seen: string[] = []
    const spy = sec.createPathRoots({ platform: 'win32', realpath: (p) => (seen.push(p), p) })
    spy.addRoot('\\\\nas\\학급')
    spy.addFile('C:\\a.mp3')
    seen.length = 0
    expect(spy.allowDir('\\\\evil\\x')).toBe(false)
    expect(spy.allowFile('\\\\evil\\a.mp3')).toBe(false)
    expect(spy.allowDir('C:\\다른')).toBe(false)
    expect(seen).toEqual([])
    expect(spy.allowDir('\\\\nas\\학급\\가')).toBe(true)
    expect(seen).toEqual(['\\\\nas\\학급\\가'])
    // 글자로는 루트 안인데 실제 경로가 없으면: knownDir 참(→ '폴더를 찾지 못했습니다'), allowDir 거짓
    const gone = sec.createPathRoots({ platform: 'win32', realpath: (p) => { if (p.includes('없음')) throw new Error('ENOENT'); return p } })
    gone.addRoot('C:\\자료')
    expect(gone.allowDir('C:\\자료\\없음')).toBe(false)
    expect(gone.knownDir('C:\\자료\\없음')).toBe(true)
    expect(gone.knownDir('C:\\밖')).toBe(false)
  })
})

describe('외부 프로그램', () => {
  test('agy 기본: 문서화된 headless(stream-json) — 인자에 글이 없고 표준 입력 한 줄에 글', () => {
    const prompt = '김학생 상담 메모: 출석률 95% "따옴표"\n둘째 줄'
    const a = agy.agyArgs(prompt)
    expect(a.join(' ')).not.toContain('김학생')
    expect(a).toEqual(['--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'plan', '--sandbox', '--disable-slash-commands'])
    expect(a).not.toContain('-p')
    const line = agy.agyStdinLine(prompt)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.slice(0, -1)).not.toContain('\n')
    expect(JSON.parse(line)).toEqual({ event: 'user', message: { content: prompt } })
    expect(() => agy.agyArgs('가'.repeat(20001))).toThrow('AI에 보낼 글이 너무 깁니다')
  })
  test('stream-json 응답 읽기: result.response, 없으면 agent_response text_delta 이어 붙이기, ERROR·로그인·빈 응답은 한국어 오류', () => {
    const ev = (o: unknown) => JSON.stringify(o)
    const init = ev({ event: 'init', conversation_id: 'c', init: { cwd: '/w', tools: [] } })
    const delta = (t: string, type = 'agent_response') => ev({ event: 'step_update', step_update: { conversation_id: 'c', step_index: 1, state: 'ACTIVE', step_type: type, text_delta: t } })
    const result = (r: Record<string, unknown>) => ev({ event: 'result', result: { conversation_id: 'c', ...r } })
    expect(agy.parseAgyStream([init, delta('안'), delta('녕'), result({ status: 'SUCCESS', response: '안녕' })].join('\n'))).toEqual({ text: '안녕' })
    expect(agy.parseAgyStream([init, delta('부분'), delta(' 답'), result({ status: 'SUCCESS' })].join('\r\n'))).toEqual({ text: '부분 답' })
    expect(agy.parseAgyStream([init, delta('무시', 'tool'), result({ status: 'SUCCESS', response: '' })].join('\n'))).toEqual({ error: 'Antigravity 응답이 없습니다.' })
    expect(agy.parseAgyStream(['warning: x', init, result({ status: 'ERROR', error: 'quota' })].join('\n')).error).toBe('Antigravity 오류: quota')
    expect(agy.parseAgyStream(result({ status: 'ERROR', error: 'authentication required' })).error).toBe(agy.LOGIN_MSG)
    expect(agy.parseAgyStream('ERROR: not authenticated')).toEqual({ error: agy.LOGIN_MSG })
    // 로그인 오류가 stderr로만 올 때(종료 1)
    expect(agy.parseAgyStream('', 'Error: not authenticated')).toEqual({ error: agy.LOGIN_MSG })
    expect(agy.parseAgyStream(init, 'authentication required')).toEqual({ error: agy.LOGIN_MSG })
    expect(agy.parseAgyStream('')).toEqual({ error: 'Antigravity 응답이 없습니다.' })
    expect(agy.parseAgyStream('garbage')).toEqual({ error: 'Antigravity 응답을 읽지 못했습니다.' })
    expect(agy.parseAgyStream([init, result({ status: 'CANCELED' })].join('\n')).error).toMatch(/Antigravity 오류/)
  })
  test('stream-json 인자를 모르는 판인지: JSON 이벤트 없이 모르는 옵션·사용법 글이면 참(모델 호출 전), 그 밖은 거짓', () => {
    expect(agy.streamRejected({ code: 1, out: '', err: "Error: unknown flag: --input-format\nUsage: agy [flags]" })).toBe(true)
    expect(agy.streamRejected({ code: 2, out: 'Usage:\n  agy [flags]', err: 'invalid value "stream-json" for --output-format' })).toBe(true)
    expect(agy.streamRejected({ code: 1, out: '', err: 'unrecognized option --input-format' })).toBe(true)
    expect(agy.streamRejected({ code: 2, out: '', err: 'flag provided but not defined: -input-format\nUsage of agy:' })).toBe(true)
    // 모델·API 오류는 인자 거절이 아니다(인자 방식으로 낮추지 않음)
    expect(agy.streamRejected({ code: 1, out: '', err: 'Error: Request contains an invalid argument.' })).toBe(false)
    expect(agy.streamRejected({ code: 1, out: '', err: 'INVALID_ARGUMENT: unrecognized field "x"' })).toBe(false)
    expect(agy.streamRejected({ code: 1, out: 'Usage: agy [flags]', err: 'unknown flag: --model-x' })).toBe(false)
    // 이벤트가 나왔으면 받아들인 것(모델 오류·빈 응답도 대체 호출 없음)
    expect(agy.streamRejected({ code: 1, out: '{"event":"init","init":{}}\n', err: 'unknown flag' })).toBe(false)
    expect(agy.streamRejected({ code: 0, out: '', err: '' })).toBe(false)
    expect(agy.streamRejected({ code: 1, out: '', err: 'authentication required' })).toBe(false)
  })
  test('연결 확인: 확인 문자(nonce)를 표준 입력으로만 보내고, 답에 그 문자가 있어야 로그인됨', () => {
    const nonce = 'W7f3a9c2e'
    const p = agy.probePrompt(nonce)
    expect(p).toContain(nonce)
    expect(agy.agyArgs(p).join(' ')).not.toContain(nonce)
    expect(agy.statusFrom('agy 1.2.0', { text: `확인: ${nonce}` }, nonce)).toMatchObject({ installed: true, loggedIn: true })
    const no = agy.statusFrom('agy 1.2.0', { text: 'OK' }, nonce)
    expect(no).toMatchObject({ installed: true, loggedIn: false })
    expect(no.message).toMatch(/입력/)
    expect(agy.statusFrom('agy 1.2.0', { error: agy.LOGIN_MSG }, nonce)).toMatchObject({ loggedIn: false, message: agy.LOGIN_MSG })
  })
  test('예전 판 대체(argv): 검증된 예전 인자 그대로, Windows .cmd 줄은 %·"·^·&·|·<·>·줄바꿈이 있어도 인자 하나', () => {
    expect(agy.agyArgvArgs('안녕')).toEqual(['-p', '안녕', '--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands'])
    expect(() => agy.agyArgvArgs('가'.repeat(20001))).toThrow('AI에 보낼 글이 너무 깁니다')
    const nasty = '95% "인용" a^b & calc | del < in > out %PATH% \\" 끝\\\n둘째'
    const line = agy.cmdLine('C:\\npm\\agy.cmd', agy.agyArgvArgs(nasty))
    expect(line).not.toMatch(/[\r\n]/)
    // cmd.exe 특수 글자는 모두 따옴표 안에 있어야 한다(따옴표 밖에 나오면 리디렉션·파이프·명령 연결)
    let inQ = false
    const inner = line.slice(1, -1)
    for (const c of inner) {
      if (c === '"') inQ = !inQ
      else if (!inQ) expect(['&', '|', '<', '>', '^', '\n']).not.toContain(c)
    }
    expect(inQ).toBe(false)
    // % 펼침이 일어나지 않음은 agy.test의 cmdExpand 왕복 시험이 확인한다
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

describe('자식 프로세스 출력 읽기', () => {
  test('조각 경계에서 잘린 한글(UTF-8 여러 바이트)도 깨지지 않는다', async () => {
    const { PassThrough } = await import('node:stream')
    const s = new PassThrough()
    const get = agy.collectText(s)
    const bytes = Buffer.from('{"event":"result","result":{"status":"SUCCESS","response":"안녕하세요"}}\n', 'utf8')
    const cut = bytes.indexOf(Buffer.from('안', 'utf8')) + 1 // '안'의 가운데
    s.write(bytes.subarray(0, cut))
    s.write(bytes.subarray(cut))
    s.end()
    await new Promise((r) => s.on('end', r))
    expect(get()).not.toContain('\uFFFD')
    expect(agy.parseAgyStream(get())).toEqual({ text: '안녕하세요' })
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
