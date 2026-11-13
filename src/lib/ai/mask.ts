/** AI 전송 전 이름·번호 가리기와 되돌리기(조사 보정 포함). */

export interface Masked {
  text: string
  /** 가명·토큰 → 원래 글자 */
  map: Record<string, string>
}

/** 주민등록번호(생년월일 6자리-뒤 7자리, 붙여 쓴 것도). 앞 6자리가 날짜 꼴일 때만(ISBN 등 제외) */
const RRN_RE = /\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-?[1-4]\d{6}\b/g
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /\+82[-. ]?\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b|\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b|\b0\d{1,2}[-. ]\d{3,4}[-. ]\d{4}\b|\b\d{3,4}-\d{4}\b/g
/** 학번: "학번 1503", "1503번"처럼 학번으로 보이는 것만(연도·금액은 그대로) */
const STUDENT_NO_RE = /(?<=학번\s*:?\s*)\d{4,5}\b|\b\d{4,5}(?=번)/g

const pseudonym = (i: number) => `학생${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 마지막 글자 받침: 0 없음, 8 ㄹ, 그 밖 >0 */
function jong(word: string): number {
  const c = word.charCodeAt(word.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return 0
  return (c - 0xac00) % 28
}

/** 메모에 흔히 쓰는 이름 꼴: 김민수 / 민수 / 지훈이(받침 있는 이름 + 이). 두 글자 이름은 성을 떼지 않는다. */
/** 두 글자 성 */
const TWO_SURNAMES = ['남궁', '황보', '제갈', '선우', '독고', '사공', '서문', '동방', '어금', '망절', '을지', '탁정']

export function nameForms(full: string): string[] {
  const raw = full.trim()
  // 영문 이름: 띄어 쓴 각 부분(2글자 이상)도 따로 가린다.
  if (/^[A-Za-z][A-Za-z .'-]*$/.test(raw)) return [...new Set([raw, ...raw.split(/\s+/).filter((x) => x.length >= 2)])]
  const n = raw.replace(/\s+/g, '')
  if (n.length < 2) return []
  const forms = [n]
  if (raw !== n) forms.push(raw)
  const surLen = n.length >= 4 && TWO_SURNAMES.includes(n.slice(0, 2)) ? 2 : 1
  if (n.length >= 3) {
    const given = n.slice(surLen)
    forms.push(given)
    if (jong(given)) forms.push(given + '이')
  } else if (jong(n)) forms.push(n + '이')
  return forms
}

/**
 * 명단 이름(성 뗀 이름·"지훈이" 꼴 포함)을 학생A…로, 전화번호·학번을 [전화1]·[번호1]로 바꾼다.
 * 같은 학생의 여러 꼴은 같은 가명이 되고, 되돌릴 때는 글에 처음 나온 꼴로 돌린다(지훈이 → 지훈).
 */
export function maskText(text: string, names: string[], map: Record<string, string> = {}): Masked {
  const out: Record<string, string> = { ...map }
  const reverse = new Map(Object.entries(out).map(([k, v]) => [v, k]))
  const count = (p: string) => Object.keys(out).filter((k) => k.startsWith(p)).length
  let n = { phone: count('[전화'), no: count('[번호'), rrn: count('[주민'), mail: count('[메일') }
  let s = text.replace(RRN_RE, (m) => {
    const t = `[주민${++n.rrn}]`
    out[t] = m
    return t
  })
  s = s.replace(EMAIL_RE, (m) => {
    const t = `[메일${++n.mail}]`
    out[t] = m
    return t
  })
  s = s.replace(PHONE_RE, (m) => {
    const t = `[전화${++n.phone}]`
    out[t] = m
    return t
  })
  s = s.replace(STUDENT_NO_RE, (m) => {
    const t = `[번호${++n.no}]`
    out[t] = m
    return t
  })
  const people = [...new Set(names.map((x) => x.trim()))].map((full) => ({ full, forms: nameForms(full) })).filter((p) => p.forms.length)
  // 긴 꼴부터 바꿔야 "김민수"가 "민수"보다 먼저 잡힌다.
  const all = people.flatMap((p) => p.forms.map((f) => ({ f, p }))).sort((a, b) => b.f.length - a.f.length)
  const pseudoOf = new Map<string, string>()
  for (const { f, p } of all) {
    if (!s.includes(f)) continue
    let ps = pseudoOf.get(p.full) ?? reverse.get(p.full) ?? [...reverse].find(([v]) => p.forms.includes(v))?.[1]
    if (!ps) {
      ps = pseudonym(Object.keys(out).filter((k) => k.startsWith('학생')).length)
      // 되돌릴 꼴: 글에 가장 먼저 나온 꼴. "지훈이"로 썼으면 "지훈"(조사는 따로 고친다)
      const first = p.forms.filter((x) => s.includes(x)).sort((a, b) => s.indexOf(a) - s.indexOf(b) || b.length - a.length)[0] ?? f
      out[ps] = first.endsWith('이') && p.forms.includes(first.slice(0, -1)) ? first.slice(0, -1) : first
      reverse.set(out[ps], ps)
    }
    pseudoOf.set(p.full, ps)
    s = s.replace(new RegExp(escapeRe(f), 'g'), ps)
  }
  return { text: s, map: out }
}

const PAIRS: [string, string][] = [
  ['은', '는'],
  ['이', '가'],
  ['을', '를'],
  ['과', '와'],
  ['이랑', '랑'],
  ['이나', '나'],
]

/** name 뒤에 올 조사를 받침에 맞게 고른다. */
export function fixJosa(name: string, josa: string): string {
  const j = jong(name)
  if (josa === '으로' || josa === '로') return j === 0 || j === 8 ? '로' : '으로'
  for (const [withJong, without] of PAIRS) if (josa === withJong || josa === without) return j ? withJong : without
  return josa
}

/** 조사 뒤가 띄어쓰기·문장부호·끝일 때만 조사로 본다("학생A이고"의 "이"는 조사가 아님). */
const JOSA = '(으로|이랑|이나|로|랑|나|은|는|이|가|을|를|과|와)?(?=[\\s.,!?"\'”’)\\]·~]|$)'

export function unmaskText(text: string, map: Record<string, string>): string {
  let out = text
  for (const [token, orig] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
    if (token.startsWith('[')) {
      out = out.split(token).join(orig)
      continue
    }
    out = out.replace(new RegExp(`${escapeRe(token)}${JOSA}`, 'g'), (_m, josa?: string) => orig + (josa ? fixJosa(orig, josa) : ''))
    out = out.split(token).join(orig) // 조사 규칙에 안 맞는 나머지(예: 학생A의)
  }
  return out
}

/** 밖(구글 등)으로 보내는 글에서 학생 이름을 ○○로(되돌리지 않음). "민수가" 같은 꼴도. */
export function hideNames(text: string, names: string[]): string {
  const forms = [...new Set(names.flatMap((n) => nameForms(n)))].sort((a, b) => b.length - a.length)
  let s = text
  for (const f of forms) s = s.replace(new RegExp(escapeRe(f), 'g'), '○○')
  return s.replace(/○○이(?=[가는를와랑의도에])/g, '○○')
}

/** 밖(구글 캘린더 등)으로 보내는 글: 이름은 ○○, 전화·주민번호·메일은 [전화]·[주민]·[메일](되돌리지 않음). */
/** 밖으로 보낼 때(되돌리지 않음)는 지역번호·휴대폰 꼴만 전화로 본다: '2025-2026 학년도', '1400-1600' 같은 범위는 그대로 */
const PHONE_EXPORT_RE = /\+82[-. ]?\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b|\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b|\b0\d{1,2}[-. ]\d{3,4}[-. ]\d{4}\b/g

export function hideForExport(text: string, names: string[]): string {
  return hideNames(text.replace(RRN_RE, '[주민]').replace(EMAIL_RE, '[메일]').replace(PHONE_EXPORT_RE, '[전화]'), names)
}
