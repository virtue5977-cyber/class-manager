import { useEffect, useState } from 'react'
import { getSttBridge, MODEL_LABEL, type SttModel, type SttStatus } from '../../lib/stt/stt'

/** 설정 > AI 아래: 음성 받아쓰기 선택 내려받기. */
export default function SttSettings() {
  const bridge = getSttBridge()
  const [st, setSt] = useState<SttStatus | null>(null)
  const [model, setModel] = useState<SttModel>('fast')
  const [prog, setProg] = useState<{ label: string; pct: number } | null>(null)
  const [msg, setMsg] = useState<string>()
  useEffect(() => {
    bridge?.status().then(setSt).catch((e) => setMsg(String(e)))
  }, [bridge])
  useEffect(
    () =>
      bridge?.onProgress((p) => {
        if (p.phase === 'run') return
        const pct = p.total ? Math.floor(((p.received ?? 0) / p.total) * 100) : 0
        setProg({ label: p.phase === 'bin' ? '실행 파일' : '모델', pct })
      }),
    [bridge],
  )
  const run = async (fn: () => Promise<SttStatus>) => {
    setMsg(undefined)
    try {
      setSt(await fn())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setProg(null)
    }
  }
  return (
    <div className="card stack">
      <h3>음성 받아쓰기</h3>
      <p className="muted">상담 녹음 파일을 이 컴퓨터 안에서 글로 바꿔 상담 기록에 넣습니다. 녹음과 글은 밖으로 나가지 않습니다. 쓰려면 프로그램(whisper.cpp)과 모델을 한 번 받아야 합니다. 노트북에서는 30분 녹음에 10~30분쯤 걸립니다.</p>
      {!bridge ? (
        <p className="muted">새 설치형(Windows 앱)이 필요합니다.</p>
      ) : !st ? null : !st.supported ? (
        <p className="muted">이 컴퓨터(Windows 64비트가 아님)에서는 쓸 수 없습니다.</p>
      ) : (
        <>
          {st.bin && st.models.length > 0 && <p>{`받아 둠: ${st.models.map((m) => MODEL_LABEL[m]).join(', ')}`}</p>}
          <div className="seg" role="radiogroup" aria-label="모델">
            {(['fast', 'accurate'] as SttModel[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={model === m} className={model === m ? 'on' : undefined} onClick={() => setModel(m)}>
                {MODEL_LABEL[m]}
              </button>
            ))}
          </div>
          {prog ? (
            <div className="row">
              <span>{`${prog.label} 받는 중 ${prog.pct}%`}</span>
              <progress max={100} value={prog.pct} />
            </div>
          ) : (
            <div className="row">
              <button type="button" className="primary" disabled={st.models.includes(model)} onClick={() => run(() => bridge.install(model))}>
                {st.models.includes(model) ? '받아 둠' : '받기'}
              </button>
              {st.bin && (
                <button type="button" className="danger-text" onClick={() => run(() => bridge.remove())}>
                  지우기
                </button>
              )}
            </div>
          )}
        </>
      )}
      {msg && <p className="error" role="alert">{msg}</p>}
    </div>
  )
}
