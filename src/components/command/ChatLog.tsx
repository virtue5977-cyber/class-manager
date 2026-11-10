import { useEffect, useRef } from 'react'
import { useDb } from '../../app/context'
import type { ChatRec } from '../../lib/db/types'
import { clearChatOn, deleteChat, listChat, schoolYearOf } from '../../lib/command/chatLog'
import { createNote, newBlockId } from '../../lib/notes/notes'
import { useLive } from '../../lib/ui/useLive'
import { toYmd } from '../../lib/schoolDays'
import ResultCard from './ResultCard'

/** 대화 기록: 내 입력(오른쪽)과 결과 카드(왼쪽). 이번 학년도만. */
export default function ChatLog({ today, onRun }: { today: string; onRun: (input: string) => void }) {
  const db = useDb()
  const list = useLive<ChatRec[]>(() => listChat(db, schoolYearOf(today)), [db, today], [])
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 새 Chromium의 scrollIntoView는 Promise를 돌려주므로 효과 함수가 그것을 반환하지 않게 감싼다.
    void end.current?.scrollIntoView?.({ block: 'end' })
  }, [list.length])
  return (
    <section className="chat-log" aria-label="대화 기록">
      {list.length === 0 && <p className="muted chat-empty">아래 입력 막대에 /를 쳐 보세요. 예: /출결 @3 결석 질병 감기 · /할일 동의서 걷기 내일 · /찾기 감기</p>}
      {list.map((c, i) => {
        const day = toYmd(new Date(c.at))
        const prev = list[i - 1] ? toYmd(new Date(list[i - 1].at)) : ''
        return (
          <div key={c.id} className="chat-item">
            {day !== prev && <div className="chat-day">{`${+day.slice(5, 7)}월 ${+day.slice(8)}일`}</div>}
            <div className="chat-me">
              <span className="bubble pii">{c.input}</span>
              <details className="chat-menu">
                <summary aria-label="메뉴">⋯</summary>
                <div className="menu-list">
                  <button type="button" onClick={() => onRun(c.input)}>다시 실행</button>
                  <button type="button" onClick={() => createNote(db, c.input.slice(0, 40), [{ id: newBlockId(), type: 'p', text: c.input }, { id: newBlockId(), type: 'p', text: c.summary }])}>노트로 보내기</button>
                  <button type="button" onClick={() => deleteChat(db, c.id)}>지우기</button>
                </div>
              </details>
            </div>
            <ResultCard chat={c} today={today} onRun={onRun} />
          </div>
        )
      })}
      <div ref={end} />
      {list.length > 0 && (
        <button type="button" className="link chat-clear" onClick={() => clearChatOn(db, today)}>
          오늘 대화 지우기
        </button>
      )}
    </section>
  )
}
