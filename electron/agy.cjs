// Antigravity CLI(agy)·Claude Code 부르기용 순수 함수. 파일을 고치지 않는 계획 모드·샌드박스로 한 번만 답하게.
// 학생 글(프롬프트)은 명령줄 인자에 넣지 않는다(다른 프로그램이 프로세스 목록에서 읽을 수 있음).
// agy 기본: 문서화된 headless 입력 `--input-format stream-json --output-format stream-json`, 표준 입력에 user 이벤트 한 줄.
// 그 인자를 모르는 예전 판만(모델 호출 전에 거절됨) 예전에 검증된 `-p <글>` 인자로 한 번 부른다(알려진 한계: 글이 인자에 보임;
// 화면에서 보내는 AI 글은 이미 이름을 가린 것). 연결 확인은 표준 입력으로만 보낸 확인 문자가 답에 있어야 통과.
const path = require('node:path')
const MAX_PROMPT = 20000
const LOGIN_MSG = 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.'
const AUTH_RE = /authentication required|not authenticated|login required/i
const NO_RESPONSE = 'Antigravity 응답이 없습니다.'
const BAD_RESPONSE = 'Antigravity 응답을 읽지 못했습니다.'
const STDIN_UNREAD = 'Antigravity가 앱이 보낸 입력을 읽지 못했습니다. 명령 창에서 agy update 로 새 판으로 올리세요.'

const SAFE_FLAGS = ['--mode', 'plan', '--sandbox', '--disable-slash-commands']
const checkLen = (prompt) => {
  if (String(prompt).length > MAX_PROMPT) throw new Error('AI에 보낼 글이 너무 깁니다. 내용을 나눠서 정리하세요.')
}
/** 기본(stream-json): 인자에 글이 없다. 글은 agyStdinLine으로 표준 입력에. */
function agyArgs(prompt) {
  checkLen(prompt)
  return ['--input-format', 'stream-json', '--output-format', 'stream-json', ...SAFE_FLAGS]
}
/** 표준 입력 한 줄: {"event":"user","message":{"content":<글>}} + 줄바꿈(JSON이라 글 속 줄바꿈은 \n으로 들어감). */
function agyStdinLine(prompt) {
  return JSON.stringify({ event: 'user', message: { content: String(prompt) } }) + '\n'
}
/** 예전 판 대체: 이 작업 전에 검증된 인자 그대로(글이 -p 인자). Windows .cmd는 cmdLine(quoteCmdArg)로만 넘긴다. */
function agyArgvArgs(prompt) {
  checkLen(prompt)
  return ['-p', String(prompt), '--output-format', 'json', ...SAFE_FLAGS]
}

const jsonEvents = (out) => {
  const events = []
  const others = []
  for (const line of String(out || '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    let o = null
    if (t.startsWith('{')) {
      try {
        o = JSON.parse(t)
      } catch {
        o = null
      }
    }
    if (o && typeof o === 'object' && typeof o.event === 'string') events.push(o)
    else others.push(t)
  }
  return { events, others }
}
/** stream-json 출력: 마지막 result 이벤트. SUCCESS면 response(없으면 agent_response 의 text_delta 이어 붙이기). */
function parseAgyStream(stdout, stderr = '') {
  const { events, others } = jsonEvents(stdout)
  const deltas = events
    .filter((e) => e.event === 'step_update' && e.step_update && e.step_update.step_type === 'agent_response' && typeof e.step_update.text_delta === 'string')
    .map((e) => e.step_update.text_delta)
    .join('')
  const results = events.filter((e) => e.event === 'result' && e.result && typeof e.result === 'object')
  const r = results.length ? results[results.length - 1].result : null
  if (r) {
    const status = String(r.status || '').toUpperCase()
    if (status === 'SUCCESS') {
      const text = typeof r.response === 'string' && r.response ? r.response : deltas
      return text.trim() ? { text } : { error: NO_RESPONSE }
    }
    const err = String(r.error || status || '알 수 없음')
    return AUTH_RE.test(err) ? { error: LOGIN_MSG } : { error: `Antigravity 오류: ${err}` }
  }
  if (AUTH_RE.test(others.join('\n') + '\n' + String(stderr || ''))) return { error: LOGIN_MSG }
  if (deltas.trim()) return { text: deltas }
  if (!events.length && others.length) return { error: BAD_RESPONSE }
  return { error: NO_RESPONSE }
}
/**
 * stream-json 인자를 모르는 판: 이벤트가 하나도 없고, 0이 아닌 종료이며, 거절 글이 --input-format/--output-format(또는 stream-json 값)을 콕 집어 말할 때만.
 * 모델·API 오류("invalid argument" 등)로는 인자 방식으로 낮추지 않는다(개인정보 후퇴 방지).
 */
const STREAM_REJECT_RE = /(unknown|unrecognized|not defined)[^\n]*(input|output)-format|invalid value[^\n]*stream-json|flag provided but not defined:\s*-+(input|output)-format/i
function streamRejected({ code, out, err }) {
  if (code === 0 || jsonEvents(out).events.length) return false
  return STREAM_REJECT_RE.test(`${err || ''}\n${out || ''}`)
}
/** 자식 프로세스 출력 모으기: utf8 해독기를 써서 조각 경계에서 잘린 한글이 깨지지 않게. 돌려주는 함수가 지금까지의 글. */
function collectText(stream) {
  let text = ''
  stream.setEncoding('utf8')
  stream.on('data', (d) => (text += d))
  return () => text
}
/** 연결 확인 글: 확인 문자를 그대로 답하게(이 글은 표준 입력으로만 보낸다). */
function probePrompt(nonce) {
  return `확인 문자 ${nonce} 만 그대로 답하세요.`
}

function parseAgyOutput(stdout) {
  const raw = String(stdout || '').trim()
  if (!raw) return { error: 'Antigravity 응답이 없습니다.' }
  if (AUTH_RE.test(raw)) return { error: LOGIN_MSG }
  try {
    const body = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    if (String(body.status).toUpperCase() === 'ERROR') return { error: `Antigravity 오류: ${body.error || '알 수 없음'}` }
    return { text: String(body.response || '') }
  } catch {
    return { error: 'Antigravity 응답을 읽지 못했습니다.' }
  }
}

/**
 * cmd.exe /d /s /c 에 넘길 한 줄(바깥 따옴표 포함). 글이 세 번 읽힌다: cmd(% 펼치기) → .cmd의 %* → 프로그램의 인자 나누기.
 * - " → "" (cmd 따옴표 상태가 깨지지 않고, 인자 나누기에서는 글자 ")
 * - " 앞과 끝의 \ 는 두 배(인자 나누기 규칙)
 * - % → %%cd:~,% (환경 변수 %USERNAME% 등이 펼쳐지지 않게; 결과는 글자 %)
 * - 줄바꿈은 cmd 한 줄에 실을 수 없어 글자 \n 으로
 */
function quoteCmdArg(a) {
  const s = String(a).replace(/\r\n|\r|\n/g, '\\n')
  let out = '"'
  let bs = 0
  for (const c of s) {
    if (c === '\\') { bs++; continue }
    if (c === '"') { out += '\\'.repeat(bs * 2) + '""'; bs = 0; continue }
    out += '\\'.repeat(bs)
    bs = 0
    out += c === '%' ? '%%cd:~,%' : c
  }
  return out + '\\'.repeat(bs * 2) + '"'
}
function cmdLine(file, args) {
  return '"' + [file, ...args].map(quoteCmdArg).join(' ') + '"'
}

/** `where agy` 출력에서 고르기: .exe → .cmd/.bat. 확장자 없는 것(npm의 sh 스크립트)은 cmd가 못 돌린다. */
function pickAgyPath(whereOut) {
  const lines = String(whereOut || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
  const exe = lines.find((x) => /\.exe$/i.test(x))
  if (exe) return { file: exe, viaCmd: false }
  const cmd = lines.find((x) => /\.(cmd|bat)$/i.test(x))
  return cmd ? { file: cmd, viaCmd: true } : null
}

/** 이 컴퓨터의 절대 경로인가(UNC·상대·드라이브 상대 거부). */
function isAbsLocal(p, platform) {
  if (typeof p !== 'string' || !p || /^[\\/]{2}/.test(p)) return false
  return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/')
}
/**
 * 프로그램 이름 → 절대 경로. `where`(Windows)·`which` 결과 가운데 이 컴퓨터의 절대 경로이고, 작업 폴더(cwd) 밖이며, 실제로 있는 것만.
 * Windows는 .exe를 먼저, 없으면 .cmd/.bat(cmd.exe로 부름). 확장자 없는 셸 스크립트는 건너뛴다.
 * run(cmd, args) 는 cwd = 작업 폴더에서 돌린다(where는 현재 폴더부터 찾으므로 그 결과는 버린다).
 */
function resolveAbs(name, { platform, cwd, run, exists }) {
  const P = platform === 'win32' ? path.win32 : path.posix
  let out = ''
  try {
    out = String(run(platform === 'win32' ? 'where' : 'which', [name]) || '')
  } catch {
    return null
  }
  const inCwd = (f) => {
    const rel = P.relative(cwd, P.dirname(f))
    return rel === '' || (!rel.startsWith('..') && !P.isAbsolute(rel))
  }
  const lines = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => isAbsLocal(x, platform) && !inCwd(x) && exists(x))
  if (platform === 'win32') return pickAgyPath(lines.join('\n'))
  return lines[0] ? { file: lines[0], viaCmd: false } : null
}

/** 시간 초과 때 끝내는 명령. Windows는 cmd.exe 아래 node/agy까지(/t). */
function killCommand(platform, pid) {
  return platform === 'win32' ? ['taskkill', ['/pid', String(pid), '/t', '/f']] : null
}

/** 연결 확인 결과: --version 출력 + 짧은 시험 질문의 parseAgyOutput 결과. */
function statusFrom(versionOut, probe, nonce) {
  const v = String(versionOut || '').trim()
  if (!v) return { installed: false }
  const version = v.split(/\s+/).pop()
  if (probe && probe.error) return { installed: true, version, loggedIn: false, message: probe.error }
  // 확인 문자가 답에 없으면 입력을 읽지 못한 것(고정 글에만 답한 것)으로 본다.
  if (nonce && !String((probe && probe.text) || '').includes(nonce)) return { installed: true, version, loggedIn: false, message: STDIN_UNREAD }
  return { installed: true, version, loggedIn: true }
}


/** Claude Code 한 번 묻기 인자: 세션 파일을 남기지 않고(학생 글이 ~/.claude에 쌓이지 않게), 도구·MCP 없이.
 * 글은 표준 입력으로. 셸을 거치지 않으므로 빈 값은 빈 글 그대로(.cmd면 cmdLine이 "" 로 인용). */
function claudeAskArgs(_platform) {
  return ['-p', '--output-format', 'json', '--max-turns', '1', '--model', 'haiku', '--no-session-persistence', '--strict-mcp-config', '--tools', '']
}

/** Claude Code가 실패했을 때 보여 줄 말 */
function claudeErrorText(text) {
  if (/unknown option|unrecognized option|unknown argument/i.test(text)) return 'Claude Code가 오래된 판입니다. 명령 창에서 claude update 를 실행해 새 판으로 올리세요.'
  if (/(session|token|oauth|login)[^\n]*expired|could not be refreshed/i.test(text)) return '로그인이 만료되었습니다. PowerShell에서 claude auth login 을 실행해 다시 로그인하세요.'
  if (/login|auth|log in/i.test(text)) return 'Claude Code에 로그인되어 있지 않습니다. PowerShell에서 claude auth login 을 실행해 로그인하세요.'
  return 'Claude Code 실행 중 오류가 났습니다. Pro 사용 한도를 확인하세요.'
}

module.exports = { claudeErrorText, claudeAskArgs, agyArgs, agyStdinLine, agyArgvArgs, parseAgyStream, streamRejected, collectText, probePrompt, resolveAbs, parseAgyOutput, quoteCmdArg, cmdLine, pickAgyPath, killCommand, statusFrom, MAX_PROMPT, LOGIN_MSG }
