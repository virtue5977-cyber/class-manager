/** ! 스킬 실행과 기호 없는 글(질문 대답·명령 제안). AI 결과는 카드로만 — 저장은 카드에서 사람이 한다. 학생 이름은 가린다. */
import { extractJson } from '../ai/client'
import { maskText, unmaskText } from '../ai/mask'
import { getPrompt } from '../ai/prompts'
import { buildBriefingPrompt } from '../briefing/briefing'
import { listLocalEvents } from '../events/localEvents'
import { listCalendar } from '../neis/schedule'
import { noticesOn } from '../notices/notices'
import { listTodos } from '../todos/todos'
import { listLogsByStudent } from '../counseling/counseling'
import { getCurrentClassId, listStudents } from '../roster/roster'
import { addDays, weekday } from '../schoolDays'
import type { RunEnv, RunResult } from './handlers'
import { parseSkill, normalizeSuggestions, SKILLS } from './skills'

const DAY = ['', '월', '화', '수', '목', '금', '토', '일']
const todayLine = (today: string) => `오늘: ${today}(${DAY[weekday(today)]}요일)`
const DATE_RULE = '상대 날짜(내일, 13일, 금요일 등)는 오늘을 기준으로 YYYY-MM-DD로 바꾼다. 시간은 HH:MM(없으면 "").'

const PROMPTS: Record<string, string> = {
  일정: `글에서 달력에 넣을 일정(날짜가 있는 행사·모임·마감)을 뽑는다. ${DATE_RULE} 제목은 짧게(20자 안팎). 최대 5개. 없는 내용을 지어내지 않는다.\n\n# 출력 형식\nJSON {"events":[{"date":"YYYY-MM-DD","time":"HH:MM","title":"제목"}]} 만.`,
  할일: `글에서 담임교사가 해야 할 일(입력·제출·준비·확인)을 뽑는다. 마감이 있으면 due(YYYY-MM-DD), 없으면 "". ${DATE_RULE} 한 줄로 짧게. 최대 5개.\n\n# 출력 형식\nJSON {"todos":[{"text":"할 일","due":"YYYY-MM-DD"}]} 만.`,
  auto: `담임교사가 붙여 넣은 글(공문·메신저·메모)을 보고 앱에 넣을 만한 것을 추천한다.\n- notices: 학생에게 알릴 전달사항. 안내 하나 = 하나, 딸린 일정·장소·준비물은 같은 칸에서 줄바꿈과 "- "로 묶는다. 교사끼리만 필요한 것은 뺀다.\n- events: 달력에 넣을 일정. ${DATE_RULE}\n- todos: 담임이 해야 할 일(마감 due).\n- summary: 두세 문장 요약.\n해당 없으면 빈 배열. 각 5개까지. 없는 내용을 지어내지 않는다.\n\n# 출력 형식\nJSON {"summary":"","notices":["…"],"events":[{"date":"","time":"","title":""}],"todos":[{"text":"","due":""}]} 만.`,
  요약: '글의 요점을 3~5줄로 쓴다. 각 줄은 "- "로 시작, 날짜·숫자·기한은 살린다.\n\n# 출력 형식\nJSON {"text":"요약"} 만.',
  누가: '교사의 관찰 메모를 학교생활기록부 누가기록 문체로 1~3문장 쓴다. 관찰한 사실 중심, "~함/~임" 꼴, 지나친 평가어와 지어낸 내용은 쓰지 않는다. 학생A 같은 가명은 그대로 둔다.\n\n# 출력 형식\nJSON {"text":"누가기록"} 만.',
}

type AiEnv = RunEnv & { ai: NonNullable<RunEnv['ai']> }

/** 추천(고칠 수 있는 카드) */
async function suggestFrom(env: AiEnv, system: string, body: string, names: string[]): Promise<RunResult> {
  const m = maskText(body, names)
  const raw = extractJson<Record<string, unknown>>(await env.ai({ system: `${todayLine(env.today)}\n\n${system}`, user: m.text.slice(0, 12000), maxTokens: 1500 }))
  const un = (v: unknown): unknown => (typeof v === 'string' ? unmaskText(v, m.map) : Array.isArray(v) ? v.map(un) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, un(x)])) : v)
  const r = un(raw) as { summary?: string; notices?: unknown[]; events?: unknown[]; todos?: unknown[]; 조례?: unknown[]; 종례?: unknown[] }
  const items = normalizeSuggestions({ notices: [...(r.notices ?? []), ...(r.조례 ?? []), ...(r.종례 ?? [])], events: r.events, todos: r.todos }, env.today)
  const summary = typeof r.summary === 'string' ? r.summary.trim() : ''
  if (!items.length && !summary) return { summary: '추천할 것을 찾지 못했습니다.', links: [], pending: true }
  return { summary: summary || `추천 ${items.length}개 — 고쳐서 넣으세요.`, links: [], card: { kind: 'suggest', data: { items } }, pending: true }
}

/** 글 한 덩이(요약·누가) */
async function textFrom(env: AiEnv, system: string, body: string, names: string[], label: string): Promise<RunResult> {
  const m = maskText(body, names)
  const reply = extractJson<{ text?: string }>(await env.ai({ system, user: m.text.slice(0, 12000), maxTokens: 900 }))
  const text = unmaskText(String(reply.text ?? '').trim(), m.map)
  if (!text) return { summary: 'AI가 글을 만들지 못했습니다.', links: [], failed: true }
  return { summary: label, links: [], card: { kind: 'draft', data: { kind: 'message', text } } }
}

/** ! 스킬 실행(전달·상담정리는 ai.ts의 옛 길을 그대로 쓰므로 여기서는 나머지) */
export async function runSkillAi(input: string, env: AiEnv, names: string[]): Promise<RunResult | null> {
  const ps = parseSkill(input)
  if (!ps.body && ps.skill !== '상담정리') {
    const sk = SKILLS.find((s) => s.id === ps.skill)
    return { summary: sk ? `${sk.help}` : '! 뒤에 글을 붙여 넣으면 할 만한 일을 추천합니다(예: !일정, !전달 학부모, !요약).', links: [], pending: true }
  }
  if (ps.skill === '일정' || ps.skill === '할일' || ps.skill === 'auto') return suggestFrom(env, PROMPTS[ps.skill], ps.body, names)
  if (ps.skill === '나누기') return suggestFrom(env, buildBriefingPrompt(await getPrompt(env.db, 'briefing'), '', env.today).system, ps.body, names)
  if (ps.skill === '요약') return textFrom(env, PROMPTS.요약, ps.body, names, '요약')
  if (ps.skill === '누가') return textFrom(env, PROMPTS.누가, ps.body, names, '누가기록 문체로 고친 글')
  return null
}

/** 질문에 답할 때 붙이는 앱 자료(부르는 쪽에서 이름을 가린다): 일정 1주, 할 일, 오늘 전달사항, 오늘 출결, 이번 달 출결 요약, @학생이면 그 학생 이번 달 출결·최근 상담 5개 */
export async function appContext(env: RunEnv, studentIds: string[] = []): Promise<string> {
  const to = addDays(env.today, 7)
  const ev = [
    ...(await listCalendar(env.db, env.today, to)).filter((r) => r.title && r.title !== '토요휴업일').map((r) => `${r.date} ${r.title}(학사)`),
    ...(await listLocalEvents(env.db, env.today, to)).map((e) => `${e.date}${e.time ? ` ${e.time}` : ''} ${e.title}`),
  ].sort()
  const todos = (await listTodos(env.db)).filter((t) => !t.done).map((t) => `${t.parts.map((p) => (typeof p === 'string' ? p : '')).join('')}${t.due ? ` (마감 ${t.due})` : ''}`)
  const notices = (await noticesOn(env.db, env.today)).map((n) => n.text.replace(/\n/g, ' '))
  const sec = (t: string, xs: string[]) => `## ${t}\n${xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- 없음'}`
  const out = [todayLine(env.today), sec('일정(7일)', ev.slice(0, 30)), sec('할 일', todos.slice(0, 20)), sec('오늘 전달사항', notices)]
  const cid = env.classId ?? (await getCurrentClassId(env.db))
  if (cid) {
    const st = await listStudents(env.db, cid)
    const by = new Map(st.map((s) => [s.id, s]))
    const who = (id: string) => `${by.get(id)?.number}번 ${by.get(id)?.name}`
    // 학년도는 3월부터, 2학기는 8월부터
    const y = Number(env.today.slice(0, 4)) - (Number(env.today.slice(5, 7)) < 3 ? 1 : 0)
    const yearFrom = `${y}-03-01`
    const sem2 = env.today >= `${y}-08-01`
    const all = (await env.db.attendance.where('date').between(yearFrom, env.today.slice(0, 10) + '\uffff', true, true).toArray()).filter((a) => !a.deleted && by.has(a.student_id))
    const month = all.filter((a) => a.date.slice(0, 7) === env.today.slice(0, 7))
    /** 종류마다 '번호 이름 n건'(많은 순, 같으면 번호 순) */
    const byKind = (list: typeof all) => {
      const m = new Map<string, Map<string, number>>()
      for (const a of list) {
        const k = `${a.kind}(${a.category})`
        const inner = m.get(k) ?? new Map<string, number>()
        inner.set(a.student_id, (inner.get(a.student_id) ?? 0) + 1)
        m.set(k, inner)
      }
      return [...m.entries()].map(([k, inner]) => `${k}: ${[...inner.entries()].sort((p, q) => q[1] - p[1] || (by.get(p[0])!.number - by.get(q[0])!.number)).map(([id, n]) => `${who(id)} ${n}건`).join(', ')}`)
    }
    out.push(sec('오늘 출결', month.filter((a) => a.date === env.today).map((a) => `${who(a.student_id)} ${a.kind}(${a.category})`)))
    out.push(sec(`이번 달 출결(${Number(env.today.slice(5, 7))}월)`, byKind(month)))
    out.push(sec(`${sem2 ? 2 : 1}학기 출결`, byKind(all.filter((a) => (a.date >= `${y}-08-01`) === sem2))))
    out.push(sec(`올해(${y}학년도) 출결`, byKind(all)))
    for (const id of studentIds.filter((x) => by.has(x))) {
      out.push(sec(`${who(id)} 이번 달 출결`, month.filter((a) => a.student_id === id).map((a) => `${a.date} ${a.kind}(${a.category})${a.reason ? ` ${a.reason}` : ''}`)))
      const logs = (await listLogsByStudent(env.db, id)).slice(0, 5)
      out.push(sec(`${who(id)} 최근 상담`, logs.map((l) => `${l.date} ${l.content.replace(/\n/g, ' ').slice(0, 120)}`)))
    }
  }
  return out.join('\n')
}
