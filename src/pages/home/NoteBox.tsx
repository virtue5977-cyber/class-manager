import { Link, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import { useDb } from '../../app/context'
import type { NoteRec } from '../../lib/db/types'
import { createNote } from '../../lib/notes/notes'

/** 노트함: 최근 노트 5개 + 새 노트 */
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
      <ul className="plain">
        {notes.slice(0, 5).map((n) => (
          <li key={n.id}>
            <Link to={`/notes?id=${n.id}`} className="note-link">
              {n.pinned && <Icon name="pin" size={12} />}
              {n.title || '제목 없음'}
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/notes" className="muted">노트함 열기 →</Link>
    </section>
  )
}
