import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDb } from '../../app/context'
import type { ChatRec, StudentRec, AttendanceRec, CounselingLogRec } from '../../lib/db/types'
import type { SearchHit } from '../../lib/command/handlers'
import { addNotice } from '../../lib/notices/notices'
import { createNote, newBlockId } from '../../lib/notes/notes'
import type { NoteBlock } from '../../lib/db/types'
import { useRecall } from './session'
import FloatingForm from './FloatingForm'

const MODE_LABEL = { rule: '규칙', hybrid: '규칙+AI', ai: 'AI' } as const

/** 실행 결과 카드: 요약·링크·되돌리기(10초)·초안/확인/학생/검색 카드·입력 창. */
export default function ResultCard({ chat, onRun, today }: { chat: ChatRec; onRun?: (input: string) => void; today: string }) {
  const db = useDb()
  const live = useRecall(chat.id)
  const r = live?.result
  const [left, setLeft] = useState(0)
  const [note, setNote] = useState<string>()
  const [formOpen, setFormOpen] = useState(false)
  // 결과가 들어오면 남은 되돌리기 시간·입력 창을 정한다.
  useEffect(() => {
    if (live?.undo) setLeft(Math.max(0, Math.ceil((live.undo.expiresAt - Date.now()) / 1000)))
    if (live?.result.form) setFormOpen(true)
  }, [live])
  const [added, setAdded] = useState<Set<number>>(new Set())
  useEffect(() => {
    if (left <= 0) return undefined
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  const card = r?.card
  /** 대답을 노트로: 입력 · 요약 · 카드 내용(초안 글·나눈 전달사항·찾은 것) · 링크 */
  async function toNote() {
    const b = (type: NoteBlock['type'], text: string): NoteBlock => ({ id: newBlockId(), type, text })
    const body: NoteBlock[] = [b('p', `입력: ${chat.input}`), b('p', chat.summary)]
    const d = card?.data as { kind?: string; text?: string; items?: string[] } | SearchHit[] | undefined
    if (card?.kind === 'draft' && d && !Array.isArray(d) && d.kind === 'message' && d.text) body.push(...d.text.split('\n').map((t) => b('p', t)))
    if (card?.kind === 'draft' && d && !Array.isArray(d) && d.kind === 'notices') body.push(...(d.items ?? []).map((t) => b('bullet', t)))
    if (card?.kind === 'search' && Array.isArray(d)) body.push(...d.map((h) => b('bullet', `${h.label} ${h.detail}`.trim())))
    body.push(...chat.links.map((l) => b('bullet', `${l.label}: #${l.to}`)))
    body.push(b('p', `— 홈 대화(${new Date(chat.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})에서`))
    await createNote(db, chat.summary.slice(0, 40), body)
    setNote('노트로 보냈습니다.')
  }
  return (
    <article className={`result-card status-${chat.status === '성공' ? 'ok' : chat.status === '실패' ? 'bad' : 'ask'}`} aria-label="결과">
      <div className="result-head">
        {chat.mode !== 'rule' && <span className={`badge mode-${chat.mode}`}>{MODE_LABEL[chat.mode]}</span>}
        <span className="result-summary pii">{chat.summary}</span>
      </div>
      {note && <p className="muted" role="status">{note}</p>}
      {card?.kind === 'student' && <StudentCard data={card.data as { student: StudentRec; atts: AttendanceRec[]; logs: CounselingLogRec[]; open: number }} />}
      {card?.kind === 'search' && (
        <ul className="plain result-list">
          {(card.data as SearchHit[]).map((h, i) => (
            <li key={i}>
              <Link to={h.to} className="pii">{h.label}</Link> <span className="muted pii">{h.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {card?.kind === 'draft' && (card.data as { kind: string }).kind === 'notices' && (
        <ul className="plain result-list">
          {(card.data as { items: string[] }).items.map((t, i) => (
            <li key={i} className="row">
              <span className="pii">{t}</span>
              <button type="button" className="link" disabled={added.has(i)} onClick={async () => { await addNotice(db, { text: t, start_date: today }); setAdded((s) => new Set(s).add(i)) }}>
                {added.has(i) ? '추가됨' : '전달사항에 추가'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {card?.kind === 'draft' && (card.data as { kind: string }).kind === 'message' && <MessageDraft text={(card.data as { text: string }).text} />}
      {card?.kind === 'confirm' && (
        <div className="row">
          <span className="pii">{(card.data as { preview: string }).preview}</span>
          <button type="button" className="primary" onClick={() => onRun?.((card.data as { command: string }).command)}>이렇게 실행</button>
        </div>
      )}
      {(chat.links.length > 0 || (live?.undo && left > 0) || chat.mode !== 'rule' || !!card) && (
        <div className="row result-actions">
          {chat.links.map((l) => (
            <Link key={l.to + l.label} to={l.to}>{l.label}</Link>
          ))}
          {live?.undo && left > 0 && (
            <button type="button" className="link" onClick={async () => { setNote((await live.undo!.undo()) ? '되돌렸습니다.' : '되돌릴 수 없습니다.'); setLeft(0) }}>
              {`되돌리기 ${left}초`}
            </button>
          )}
          {(chat.mode !== 'rule' || !!card) && (
            <button type="button" className="link" onClick={toNote}>
              노트로
            </button>
          )}
        </div>
      )}
      {r?.form && formOpen && <FloatingForm form={r.form} onClose={(m) => { setFormOpen(false); if (m) setNote(m) }} />}
      {r?.form && !formOpen && !note && <button type="button" className="link" onClick={() => setFormOpen(true)}>입력 창 열기</button>}
    </article>
  )
}

function StudentCard({ data }: { data: { student: StudentRec; atts: AttendanceRec[]; logs: CounselingLogRec[]; open: number } }) {
  const s = data.student
  return (
    <div className="student-card pii">
      <p>{[s.phone && `학생 ${s.phone}`, s.guardian_name && `보호자 ${s.guardian_name}${s.guardian_relation ? `(${s.guardian_relation})` : ''}`, s.guardian_phone].filter(Boolean).join(' · ') || '연락처가 없습니다(학급 > 명단).'}</p>
      <p className="muted">{`최근 출결: ${data.atts.map((a) => `${+a.date.slice(5, 7)}/${+a.date.slice(8)} ${a.kind}`).join(', ') || '없음'} · 미제출 신고서 ${data.open}건`}</p>
      <p className="muted">{`최근 상담: ${data.logs.map((l) => `${+l.date.slice(5, 7)}/${+l.date.slice(8)} ${l.content.slice(0, 20)}`).join(' / ') || '없음'}`}</p>
    </div>
  )
}

function MessageDraft({ text }: { text: string }) {
  const [t, setT] = useState(text)
  const [copied, setCopied] = useState(false)
  return (
    <div className="stack">
      <textarea aria-label="보낼 글" rows={3} value={t} onChange={(e) => setT(e.target.value)} />
      <button type="button" onClick={async () => { await navigator.clipboard?.writeText(t); setCopied(true) }}>{copied ? '복사됨' : '복사'}</button>
    </div>
  )
}
