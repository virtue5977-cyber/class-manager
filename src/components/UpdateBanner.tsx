import { useEffect, useState } from 'react'
import { getDesktopUpdate, type UpdateState } from '../lib/update/update'

/** 새 버전 안내(exe): 받아 둔 뒤 "다시 시작". */
export default function UpdateBanner() {
  const [st, setSt] = useState<UpdateState | null>(null)
  useEffect(() => {
    const d = getDesktopUpdate()
    if (d) {
      d.get().then(setSt)
      return d.onState(setSt)
    }
    return undefined
  }, [])
  if (!st) return null
  const extra = [st.notice, st.warning].filter(Boolean) as string[]
  const notes = extra.map((t) => (
    <div key={t} className="banner update" role="status">{t}</div>
  ))
  if (st.status === 'ready')
    return (
      <>
        {st.notice && notes[0]}
        <div className="banner update" role="status">
          {`새 버전 ${st.version}을(를) 받아 두었습니다.${st.note ? ` (${st.note})` : ''}${st.warning ? ` ${st.warning}.` : ''} `}
          <button type="button" className="primary" onClick={() => getDesktopUpdate()!.restart()}>
            지금 다시 시작해 적용
          </button>
        </div>
      </>
    )
  if (st.status === 'need-exe')
    return (
      <>
        {notes}
        <div className="banner update" role="status">{`새 버전 ${st.version}은(는) 프로그램(exe)을 새로 받아야 합니다. 담당자에게 새 파일을 받아 주세요.`}</div>
      </>
    )
  return notes.length ? <>{notes}</> : null
}
