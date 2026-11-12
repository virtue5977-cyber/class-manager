import type { NoteRec } from '../../lib/db/types'

/** 전달사항과 이어진 노트 표: 작게 [전달 11/13] */
export default function NoticeTag({ note }: { note: Pick<NoteRec, 'notice_date' | 'title'> }) {
  if (!note.notice_date) return null
  const d = `${+note.notice_date.slice(5, 7)}/${+note.notice_date.slice(8)}`
  return (
    <span className="badge notice-badge" title={`${d} 전달사항과 이어진 노트`}>
      {`[전달 ${d}]`}
    </span>
  )
}

/** 목록에 보일 제목: 짝 노트 제목 앞의 '[전달사항]'은 표와 겹치므로 뺀다 */
export function shownTitle(note: Pick<NoteRec, 'notice_date' | 'title'>): string {
  const t = (note.title || '').trim()
  if (!note.notice_date) return t || '제목 없음'
  return t.replace(/^\[전달사항\]\s*/, '') || '전달사항'
}
