import { useState } from 'react'
import { APP_VERSION, checkHtmlUpdate, getDesktopUpdate, type UpdateState } from '../../lib/update/update'
import { useFs } from '../../app/context'
import { helperCmd } from '../../lib/desktop/shortcutHelper'

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
    <>
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
    {d && <ShortcutHelper />}
    </>
  )
}

/** 바탕화면 바로가기·켤 때 자동 실행(exe를 바꾸지 않는 도우미 파일) */
function ShortcutHelper() {
  const fs = useFs()
  const [done, setDone] = useState<string>()
  const get = (kind: 'install' | 'remove') => {
    const f = helperCmd(kind)
    fs.downloadFile(f.name, f.bytes)
    setDone(`${f.name}을(를) 받았습니다. 받은 파일을 두 번 누르세요.`)
  }
  return (
    <div className="card stack wide" aria-label="바로가기·자동 실행">
      <h3>바탕화면 바로가기 · 켤 때 자동 실행</h3>
      <p className="muted">도우미 파일을 받아 두 번 누르면 PC에서 Watson.exe를 찾아 바탕화면 바로가기와 시작 프로그램(컴퓨터를 켜면 자동 실행)을 만듭니다. 처음 실행할 때 Windows가 경고하면 '추가 정보 → 실행'을 누르세요. Watson 폴더를 옮기면 다시 실행하세요.</p>
      <div className="row">
        <button type="button" onClick={() => get('install')}>바로가기·자동 실행 만들기(.cmd 받기)</button>
        <button type="button" onClick={() => get('remove')}>자동 실행 끄기(.cmd 받기)</button>
      </div>
      {done && <p role="status">{done}</p>}
      <details>
        <summary>직접 하는 방법</summary>
        <ol className="muted">
          <li>Watson 폴더에서 Watson.exe를 마우스 오른쪽 단추로 눌러 '바로 가기 만들기'를 고르고, 만든 바로가기를 바탕화면으로 옮깁니다.</li>
          <li>자동 실행: Win+R을 누르고 <code>shell:startup</code>을 쳐서 열린 폴더에 그 바로가기를 하나 더 넣습니다. 끄려면 그 폴더에서 지웁니다.</li>
        </ol>
      </details>
    </div>
  )
}
