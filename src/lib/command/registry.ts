import type { Parsed } from './parse'
import { CATEGORY_WORDS, KINDS } from './lexicon'

/** 명령 표(이름·도움말·자동완성용). 실행은 handlers.ts. */
export interface CommandMeta {
  id: string
  names: string[]
  group: '기록' | '조회' | '일정' | '정리' | '이동'
  mode: 'rule' | 'hybrid' | 'ai'
  help: string
  subs?: string[]
  tags?: string[]
  /** 지금까지 해석된 것을 보고 다음에 올 낱말 후보 */
  expects?(p: Parsed): string[]
}

export const COMMAND_META: CommandMeta[] = [
  {
    id: 'attendance', names: ['출결'], group: '기록', mode: 'rule', help: '/출결 @학생 결석 질병 사유 — 출결 저장(신고서 자동)',
    expects: (p) => (!p.kind ? [...KINDS] : !p.category ? CATEGORY_WORDS : []),
  },
  { id: 'counsel', names: ['상담기록', '상담'], group: '기록', mode: 'rule', help: '/상담기록 @학생 내용 — 상담 기록 저장' },
  { id: 'info', names: ['정보'], group: '조회', mode: 'rule', help: '/정보 @학생 — 연락처·최근 출결·상담' },
  { id: 'event', names: ['일정'], group: '일정', mode: 'rule', help: '/일정 달력 내일 15:30 #업무 협의회 · /일정 할일 …', subs: ['달력', '할일'], tags: ['개인', '업무'] },
  { id: 'todo', names: ['할일'], group: '일정', mode: 'rule', help: '/할일 내용 @노트 — 오늘 할 일(마감일은 날짜 말로)' },
  { id: 'search', names: ['찾기'], group: '조회', mode: 'rule', help: '/찾기 낱말 — 출결·상담·일정·노트에서' },
  { id: 'notice', names: ['전달'], group: '정리', mode: 'hybrid', help: '/전달 내용 — 전달사항 그대로 · /전달 학생 내용 — 학생에게 맞게 고쳐서(AI) · /전달 학부모|교사 내용 — 문자 초안(AI)', subs: ['학생', '학부모', '교사'] },
  { id: 'note', names: ['노트'], group: '정리', mode: 'rule', help: '/노트 제목 — 새 노트' },
  { id: 'counselDraft', names: ['상담정리'], group: '정리', mode: 'ai', help: '/상담정리 @학생 — 미정리 기록을 누가기록 초안으로(AI)' },
  { id: 'report', names: ['신고서'], group: '기록', mode: 'rule', help: '/신고서 @학생 — 최근 결석신고서 한글 파일' },
  { id: 'reflection', names: ['반성문'], group: '정리', mode: 'rule', help: '/반성문 @학생 — 반성문 화면' },
  { id: 'seat', names: ['자리'], group: '이동', mode: 'rule', help: '/자리 — 자리배치 화면' },
  { id: 'export', names: ['내보내기'], group: '이동', mode: 'rule', help: '/내보내기 화면 [한글·엑셀·PDF·인쇄] — 형식까지 쓰면 바로 저장·인쇄, 없으면 메뉴', subs: ['출결', '신고서', '통계', '상담일지', '명단', '명렬표', '자리배치', '청소배치', '달력'] },
]

/** 이름·별칭 → id */
export function commandNames(cmds: CommandMeta[] = COMMAND_META): Record<string, string> {
  return Object.fromEntries(cmds.flatMap((c) => c.names.map((n) => [n, c.id])))
}
export function commandSubs(cmds: CommandMeta[] = COMMAND_META): Record<string, string[]> {
  return Object.fromEntries(cmds.filter((c) => c.subs).map((c) => [c.id, c.subs!]))
}
export const commandLabel = (id: string) => COMMAND_META.find((c) => c.id === id)?.names[0] ?? id
