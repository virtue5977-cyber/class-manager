/** /설명서: 명령·스킬·@·단축키 안내 */
import { COMMAND_META } from './registry'
import { SKILLS } from './skills'
import { SHORTCUT_TABLE } from '../ui/shortcuts'

export interface HelpSection {
  title: string
  rows: { keys: string; label: string }[]
}

const tail = (help: string) => help.replace(/^\S+\s*/, '').replace(/^[^—]*—\s*/, '') || help

export function helpSections(): HelpSection[] {
  const isNote = (k: string) => k.startsWith('노트')
  return [
    { title: '/ 빠른 실행', rows: COMMAND_META.map((c) => ({ keys: `/${c.names[0]}`, label: tail(c.help) })) },
    { title: '! AI 실행', rows: [...SKILLS.map((s) => ({ keys: `!${s.id}`, label: tail(s.help) })), { keys: '! 글 붙여넣기', label: '일정·할 일·전달사항을 알아서 추천' }] },
    {
      title: '@ 학생·노트',
      rows: [
        { keys: '@3 · @박도윤', label: '번호나 이름으로 학생(어느 명령에서든)' },
        { keys: '@노트 제목', label: '노트 연결(할 일·전달사항·노트 글)' },
        { keys: '그냥 쓰기', label: '앱 자료로 대답하거나 맞는 명령을 알려 줌' },
      ],
    },
    { title: '앱 단축키', rows: SHORTCUT_TABLE.filter((r) => !isNote(r.keys)) },
    { title: '노트 단축키', rows: SHORTCUT_TABLE.filter((r) => isNote(r.keys)).map((r) => ({ ...r, keys: r.keys.replace(/^노트(·전달사항)? 안?:\s*/, '') })) },
  ]
}
