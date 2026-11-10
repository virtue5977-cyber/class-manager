// Antigravity CLI(agy) 부르기용 순수 함수. 한 번만 답하게(-p), 파일을 고치지 않는 계획 모드·샌드박스로.
const MAX_PROMPT = 20000
const LOGIN_MSG = 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.'

function agyArgs(prompt) {
  if (prompt.length > MAX_PROMPT) throw new Error('AI에 보낼 글이 너무 깁니다. 내용을 나눠서 정리하세요.')
  return ['-p', prompt, '--output-format', 'json', '--mode', 'plan', '--sandbox', '--disable-slash-commands']
}

function parseAgyOutput(stdout) {
  const raw = String(stdout || '').trim()
  if (!raw) return { error: 'Antigravity 응답이 없습니다.' }
  if (/authentication required|not authenticated|login required/i.test(raw)) return { error: LOGIN_MSG }
  try {
    const body = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    if (String(body.status).toUpperCase() === 'ERROR') return { error: `Antigravity 오류: ${body.error || '알 수 없음'}` }
    return { text: String(body.response || '') }
  } catch {
    return { error: 'Antigravity 응답을 읽지 못했습니다.' }
  }
}

/** Windows의 .cmd를 셸 없이 부를 때 쓰는 인용(cmd.exe 규칙: " → "", % → %%). */
function quoteCmdArg(a) {
  return '"' + String(a).replace(/"/g, '""').replace(/%/g, '%%').replace(/[\r\n]+/g, ' ') + '"'
}

module.exports = { agyArgs, parseAgyOutput, quoteCmdArg, MAX_PROMPT, LOGIN_MSG }
