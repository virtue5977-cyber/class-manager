import { Link, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import { useDb } from '../../app/context'
import type { NoteRec } from '../../lib/db/types'
import { createNote } from '../../lib/notes/notes'
import { toYmd } from '../../lib/schoolDays'
import NoticeTag from '../notes/NoticeTag'

/** 최근 노트: 오늘·앞날짜 전달사항 노트 → 고정 → 최근에 고친 순(끌어서 정한 순서와 상관없이) 10개 */
export const recentNotes = (notes: NoteRec[], today = toYmd(new Date())) => {
  const ahead = (n: NoteRec) => (n.notice_date && n.notice_date >= today ? n.notice_date : '')
  return [...notes].sort((a, b) => Number(!!ahead(b)) - Number(!!ahead(a)) || ahead(a).localeCompare(ahead(b)) || Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)).slice(0, 10)
}

/** 노트함: 최근 노트 10개(아이콘·줄 맞춤, 넓은 칸이면 미리보기·날짜) + 새 노트 */
export default function NoteBox({ notes }: { notes: NoteRec[] }) {
  const db = useDb()
  const navigate = useNavigate()
  return (
    <section className="panel-card" aria-label="노트함">
      <div className="row between">
        <h3>노트함</h3>
        <button type="button" className="link" onClick={async () => navigate(`/notes?id=${(await createNote(db)).id}`)}>
          + 새 노트
        </button>
      </div>
      {notes.length === 0 && <p className="muted">노트가 없습니다.</p>}
      <ul className="plain notebox-list">
        {recentNotes(notes).map((n) => (
          <li key={n.id}>
            <Link to={`/notes?id=${n.id}`} className="note-link notebox-row">
              <span className="tree-ico" aria-hidden="true"><Icon name="doc" size={15} /></span>
              <NoticeTag note={n} />
              <span className="notebox-title">{n.title || '제목 없음'}</span>
              {n.pinned && <Icon name="pin" size={12} />}
              <span className="notebox-peek muted pii">{n.blocks.map((b) => b.text ?? "").join(" ").trim().slice(0, 60)}</span>
              <span className="notebox-date muted">{`${+n.updated_at.slice(5, 7)}/${+n.updated_at.slice(8, 10)}`}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/notes" className="muted">노트함 열기 →</Link>
    </section>
  )
}
