import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../app/context'
import { deleteThread, listThreads, schoolYearOf } from '../lib/command/chatLog'
import { newThread, setCurrentThread, useCurrentThread } from '../lib/command/chatThreads'
import { toYmd } from '../lib/schoolDays'
import { useLive } from '../lib/ui/useLive'
import Icon from './Icon'

/** 왼쪽 메뉴 아래 '최근 대화': 누르면 홈에서 그 대화, 휴지통으로 지우기(한 번 더 묻기), 모두 지우기. */
export default function RecentChats() {
  const db = useDb()
  const nav = useNavigate()
  const cur = useCurrentThread()
  const year = schoolYearOf(toYmd(new Date()))
  const threads = useLive(() => listThreads(db, year), [db, year], [])
  const [ask, setAsk] = useState<string>()
  const [all, setAll] = useState(false)
  if (!threads.length) return null
  const remove = async (id: string) => {
    setAsk(undefined)
    await deleteThread(db, id)
    if (id === cur) newThread()
  }
  return (
    <section className="recent-chats" aria-label="최근 대화">
      <h3>최근 대화</h3>
      <ul className="plain">
        {threads.slice(0, 10).map((t) => (
          <li key={t.id} className={t.id === cur ? 'on' : undefined}>
            <button type="button" className="recent-title pii" title={t.title} onClick={() => (setCurrentThread(t.id), nav('/'))}>
              {t.title}
            </button>
            {ask === t.id ? (
              <span className="recent-ask" role="group" aria-label="대화 지우기 확인">
                <button type="button" className="link danger-text" onClick={() => void remove(t.id)}>지우기</button>
                <button type="button" className="link" onClick={() => setAsk(undefined)}>취소</button>
              </span>
            ) : (
              <button type="button" className="icon-btn recent-del" aria-label={`대화 '${t.title}' 지우기`} title="대화 지우기" onClick={() => setAsk(t.id)}>
                <Icon name="trash" size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {all ? (
        <p className="recent-ask" role="group" aria-label="대화 모두 지우기 확인">
          <span>{`대화 ${threads.length}개를 모두 지울까요?`}</span>
          <button type="button" className="link danger-text" onClick={async () => { setAll(false); for (const t of threads) await deleteThread(db, t.id); newThread() }}>모두 지우기</button>
          <button type="button" className="link" onClick={() => setAll(false)}>취소</button>
        </p>
      ) : (
        <button type="button" className="link recent-all" onClick={() => setAll(true)}>모두 지우기</button>
      )}
    </section>
  )
}
