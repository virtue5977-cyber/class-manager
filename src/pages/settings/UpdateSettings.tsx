import { useState } from 'react'
import { APP_VERSION, checkHtmlUpdate, getDesktopUpdate, type UpdateState } from '../../lib/update/update'

const text = (s: UpdateState) =>
  s.status === 'latest' ? '최신 버전입니다.'
  : s.status === 'ready' ? `새 버전 ${s.version}을(를) 받아 두었습니다. 화면 위 안내에서 다시 시작하세요.`
  : s.status === 'need-exe' ? `새 버전 ${s.version}은(는) exe를 새로 받아야 합니다.`
  : s.status === 'html-available' ? `새 버전 ${s.version}이(가) 있습니다. 화면 위 안내에서 새 파일을 받으세요.`
  : s.status === 'error' ? s.message
  : '확인 중…'

export default function UpdateSettings() {
  const [msg, setMsg] = useState<string>()
  const d = getDesktopUpdate()
  return (
    <div className="card stack wide" aria-label="업데이트">
      <h3>{`업데이트 · 지금 버전 ${APP_VERSION}`}</h3>
      <p className="muted">{d ? 'exe는 켤 때마다 새 버전을 확인해 받아 두고, 다시 시작하면 바뀝니다. 서명이 맞는 업데이트만 적용합니다.' : 'HTML 버전은 새 버전이 있으면 화면 위에 알려 주고, 새 파일을 받아 바꾸면 됩니다. 자료는 그대로 남습니다.'}</p>
      <div className="row">
        <button type="button" onClick={async () => { setMsg('확인 중…'); const s = d ? await d.check() : await checkHtmlUpdate(); setMsg(text(s)) }}>
          지금 업데이트 확인
        </button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </div>
  )
}
