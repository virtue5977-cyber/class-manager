import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import { useDb } from '../../app/context'
import type { NoteRec } from '../../lib/db/types'
import { createNote } from '../../lib/notes/notes'
import { toYmd } from '../../lib/schoolDays'
import { NoteIcon, shownTitle } from '../notes/NoticeTag'
import { linkNoteToDate, noticeNoteOf, unlinkNoticeNote } from '../../lib/notices/noteSync'

/** 최근 노트: 오늘·앞날짜 전달사항 노트 → 고정 → 최근에 고친 순(끌어서 정한 순서와 상관없이) 10개 */
export const recentNotes = (notes: NoteRec[], today = toYmd(new Date())) => {
  const ahead = (n: NoteRec) => (n.notice_date && n.notice_date >= today ? n.notice_date : '')
  return [...notes].sort((a, b) => Number(!!ahead(b)) - Number(!!ahead(a)) || ahead(a).localeCompare(ahead(b)) || Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at)).slice(0, 10)
}

/** 노트함: 최근 노트 10개(아이콘·줄 맞춤, 넓은 칸이면 미리보기·날짜) + 새 노트 */
export default function NoteBox({ notes, today = toYmd(new Date()) }: { notes: NoteRec[]; today?: string }) {
  const db = useDb()
  const navigate = useNavigate()
  /** 오늘 짝 노트가 이미 있을 때 묻기 */
  const [ask, setAsk] = useState<string>()
  async function toggleNotice(n: NoteRec) {
    if (n.notice_date) return unlinkNoticeNote(db, n.id)
    const old = await noticeNoteOf(db, today)
    if (old && old.id !== n.id) return setAsk(n.id)
    await linkNoteToDate(db, n.id, today)
  }
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
        {recentNotes(notes, today).map((n) => (
          <li key={n.id} className="notebox-item">
            <Link to={`/notes?id=${n.id}`} className="note-link notebox-row">
              <NoteIcon note={n} />
              <span className="notebox-title">{shownTitle(n)}</span>
              {n.pinned && <Icon name="pin" size={12} />}
              <span className="notebox-peek muted pii">{n.blocks.map((b) => b.text ?? "").join(" ").trim().slice(0, 60)}</span>
              <span className="notebox-date muted">{`${+n.updated_at.slice(5, 7)}/${+n.updated_at.slice(8, 10)}`}</span>
            </Link>
            <span className="hover-tools">
              <button
                type="button"
                className={`icon-btn${n.notice_date ? ' on' : ''}`}
                aria-label={`${n.title || '제목 없음'} ${n.notice_date ? '전달사항에서 빼기' : '전달사항으로'}`}
                title={n.notice_date ? '전달사항에서 빼기(노트는 남음)' : '오늘 전달사항으로(노트 한 장 = 오늘 전달사항)'}
                onClick={() => void toggleNotice(n)}
              >
                <Icon name="megaphone" size={14} />
              </button>
            </span>
            {ask === n.id && (
              <span className="row confirm-inline" role="group" aria-label="오늘 전달사항 노트가 이미 있음">
                <span>오늘 전달사항 노트가 이미 있습니다.</span>
                <button type="button" onClick={async () => { setAsk(undefined); await linkNoteToDate(db, n.id, today, 'merge') }}>합치기</button>
                <button type="button" onClick={async () => { setAsk(undefined); await linkNoteToDate(db, n.id, today, 'replace') }}>바꾸기</button>
                <button type="button" onClick={() => setAsk(undefined)}>취소</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <Link to="/notes" className="muted">노트함 열기 →</Link>
    </section>
  )
}
