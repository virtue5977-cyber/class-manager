import { parseSkill, SKILLS, skillSuggestions, normalizeSuggestions } from './skills'

test('! 스킬 읽기: 이름·하위·본문, 스킬 없이 붙여 넣으면 auto, 모르는 이름도 auto(글 전체가 본문)', () => {
  expect(parseSkill('!전달 학부모 내일 체육복 챙겨 주세요')).toEqual({ skill: '전달', sub: '학부모', body: '내일 체육복 챙겨 주세요' })
  expect(parseSkill('!일정\n13일 3교시 수학 올림픽')).toEqual({ skill: '일정', sub: undefined, body: '13일 3교시 수학 올림픽' })
  expect(parseSkill('! 공문 내용입니다')).toEqual({ skill: 'auto', sub: undefined, body: '공문 내용입니다' })
  expect(parseSkill('!안녕 반가워')).toEqual({ skill: 'auto', sub: undefined, body: '안녕 반가워' })
  expect(parseSkill('!전달 학생')).toEqual({ skill: '전달', sub: '학생', body: '' })
  expect(SKILLS.map((s) => s.id)).toEqual(['전달', '일정', '할일', '나누기', '요약', '누가', '상담정리'])
})

test('! 자동완성: 스킬 → 하위', () => {
  expect(skillSuggestions('!').map((s) => s.label).slice(0, 3)).toEqual(['!전달', '!일정', '!할일'])
  expect(skillSuggestions('!전').map((s) => s.label)).toEqual(['!전달'])
  expect(skillSuggestions('!전달 ').map((s) => s.label)).toEqual(['!전달 학생', '!전달 교사', '!전달 학부모'])
  expect(skillSuggestions('!전달 학부모 ')).toEqual([])
})

test('AI 추천 정리: 날짜·시간 형식이 아니면 비우고, 빈 글은 버리고, 개수 제한', () => {
  const s = normalizeSuggestions({ notices: ['수학 올림픽\n- 3교시', ' '], events: [{ date: '2026-11-13', time: '9:00', title: '올림픽' }, { date: '13일', title: 'x' }], todos: [{ text: '명단 입력', due: '2026-11-11' }] }, '2026-11-12')
  expect(s).toEqual([
    { kind: 'notice', text: '수학 올림픽\n- 3교시', date: '2026-11-12' },
    { kind: 'event', text: '올림픽', date: '2026-11-13', time: '09:00' },
    { kind: 'event', text: 'x', date: '2026-11-12', time: '' },
    { kind: 'todo', text: '명단 입력', date: '2026-11-11' },
  ])
})
