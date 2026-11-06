import { useEffect, useState } from 'react'
import { useFs } from '../app/context'
import { checkHtmlUpdate, fetchNewHtml, getDesktopUpdate, type UpdateState } from '../lib/update/update'

/** 새 버전 안내: exe는 받아 둔 뒤 "다시 시작", HTML은 새 파일 받기. */
export default function UpdateBanner() {
  const fs = useFs()
  const [st, setSt] = useState<UpdateState | null>(null)
  const [msg, setMsg] = useState<string>()
  useEffect(() => {
    const d = getDesktopUpdate()
    if (d) {
      d.get().then(setSt)
      return d.onState(setSt)
    }
    // HTML 버전은 파일로 열었을 때만 확인(개발 서버 제외)
    if (location.protocol === 'file:') checkHtmlUpdate().then(setSt)
    return undefined
  }, [])
  if (!st) return null
  if (st.status === 'ready')
    return (
      <div className="banner update" role="status">
        {`새 버전 ${st.version}을(를) 받아 두었습니다.${st.note ? ` (${st.note})` : ''} `}
        <button type="button" className="primary" onClick={() => getDesktopUpdate()!.restart()}>
          지금 다시 시작해 적용
        </button>
      </div>
    )
  if (st.status === 'need-exe')
    return <div className="banner update" role="status">{`새 버전 ${st.version}은(는) 프로그램(exe)을 새로 받아야 합니다. 담당자에게 새 파일을 받아 주세요.`}</div>
  if (st.status === 'html-available')
    return (
      <div className="banner update" role="status">
        {`새 버전 ${st.version}이(가) 있습니다.${st.note ? ` (${st.note})` : ''} `}
        <button
          type="button"
          className="primary"
          onClick={async () => {
            try {
              fs.downloadFile('담임업무.html', await fetchNewHtml())
              setMsg('받은 담임업무.html로 지금 파일을 바꾸고 다시 여세요. 자료는 그대로 남습니다.')
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e))
            }
          }}
        >
          새 파일 받기
        </button>
        {msg && <span> {msg}</span>}
      </div>
    )
  return null
}
