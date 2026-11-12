import type { NoteRec } from '../../lib/db/types'

/** 전달사항과 이어진 노트 표: 제목이 이미 '[전달사항]'으로 시작하면 날짜만 */
export default function NoticeTag({ note }: { note: Pick<NoteRec, 'notice_date' | 'title'> }) {
  if (!note.notice_date) return null
  const d = `${+note.notice_date.slice(5, 7)}/${+note.notice_date.slice(8)}`
  if (note.title?.startsWith('[전달사항]')) return null
  return (
    <span className="badge notice-badge" title={`${d} 전달사항과 이어진 노트`}>
      {`[전달사항] ${d}`}
    </span>
  )
}
