import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/context'
import type { ChatRec } from '../../lib/db/types'
import { deleteChat, deleteThread, listChat, schoolYearOf } from '../../lib/command/chatLog'
import { newThread, useCurrentThread } from '../../lib/command/chatThreads'
import { createNote, newBlockId } from '../../lib/notes/notes'
import { useLive } from '../../lib/ui/useLive'
import { toYmd } from '../../lib/schoolDays'
import ResultCard from './ResultCard'
import { usePending } from '../../lib/command/pending'
import TypingBubble from './TypingBubble'

/** 대화 기록: 지금 대화 묶음의 내 입력(오른쪽)과 결과 카드(왼쪽). 이번 학년도만. 지난 대화는 왼쪽 메뉴 '최근 대화'. */
export default function ChatLog({ today, onRun }: { today: string; onRun: (input: string) => void }) {
  const db = useDb()
  const thread = useCurrentThread()
  const [askClear, setAskClear] = useState(false)
  const list = useLive<ChatRec[]>(() => listChat(db, schoolYearOf(today), thread), [db, today, thread], [])
  const waiting = usePending().filter((p) => p.thread === thread && !(p.chatId && list.some((c) => c.id === p.chatId)))
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 새 Chromium의 scrollIntoView는 Promise를 돌려주므로 효과 함수가 그것을 반환하지 않게 감싼다.
    void end.current?.scrollIntoView?.({ block: 'end' })
  }, [list.length, waiting.length])
  return (
    <section className="chat-log" aria-label="대화 기록">
      {list.length === 0 && waiting.length === 0 && <p className="muted chat-empty"><b>/</b> 빠른 실행(예: /출결 @3 결석 질병) · <b>!</b> AI 실행(예: !전달 학부모, !일정, ! 뒤에 공문 붙여넣기) · <b>@</b> 학생·노트 · 질문은 그냥 쓰세요. 모르면 <b>/설명서</b></p>}
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
                  <button type="button" onClick={() => createNote(db, c.input.slice(0, 40), [{ id: newBlockId(), type: 'p', text: c.input }, { id: newBlockId(), type: 'p', text: c.summary }, ...c.links.map((l) => ({ id: newBlockId(), type: 'bullet' as const, text: `${l.label}: #${l.to}` })), { id: newBlockId(), type: 'p', text: `— 홈 대화 기록(${new Date(c.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })})에서` }])}>노트로 보내기</button>
                  <button type="button" onClick={() => deleteChat(db, c.id)}>지우기</button>
                </div>
              </details>
            </div>
            <ResultCard chat={c} today={today} onRun={onRun} />
          </div>
        )
      })}
      {waiting.map((p) => (
        <div key={p.id} className="chat-item chat-waiting">
          <div className="chat-me">
            <span className="bubble pii">{p.input}</span>
          </div>
          <TypingBubble />
        </div>
      ))}
      <div ref={end} />
      {list.length > 0 && (
        askClear ? (
          <p className="row chat-clear" role="group" aria-label="이 대화 지우기 확인">
            <span>이 대화를 지울까요? 되돌릴 수 없습니다.</span>
            <button type="button" className="link danger-text" onClick={async () => { setAskClear(false); await deleteThread(db, thread); newThread() }}>지우기</button>
            <button type="button" className="link" onClick={() => setAskClear(false)}>취소</button>
          </p>
        ) : (
          <button type="button" className="link chat-clear" onClick={() => setAskClear(true)}>
            이 대화 지우기
          </button>
        )
      )}
    </section>
  )
}
