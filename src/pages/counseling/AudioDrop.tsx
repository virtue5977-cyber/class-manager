import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AUDIO_EXT, DIRECT_EXT, getSttBridge, MODEL_ORDER, toWav16k, type SttModel } from '../../lib/stt/stt'

/** 상담 기록 내용 칸 위: 녹음 파일을 끌어 놓으면 이 컴퓨터 안에서 글로 바꿔 onText로 넘긴다.
 * 음성 받아쓰기를 받아 둔 설치형에서만 보인다. */
export default function AudioDrop({ onText }: { onText: (text: string) => void }) {
  const bridge = getSttBridge()
  const [models, setModels] = useState<SttModel[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pct, setPct] = useState(0)
  const [msg, setMsg] = useState<string>()
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  /** 취소를 누른 뒤 끝난 결과는 버린다(주 프로세스가 아직 시작 전이라 취소가 닿지 않았을 때도) */
  const cancelled = useRef(false)
  useEffect(() => {
    let live = true
    bridge?.status().then((s) => live && setModels(s.supported && s.bin ? s.models : [])).catch(() => live && setModels([]))
    return () => {
      live = false
    }
  }, [bridge])
  useEffect(() => bridge?.onProgress((p) => p.phase === 'run' && p.percent != null && setPct(p.percent)), [bridge])
  if (!bridge || !models?.length) return null
  const model: SttModel = MODEL_ORDER.find((m) => models.includes(m)) ?? models[0]

  async function take(file: File | undefined) {
    if (!file || busy || !bridge) return
    if (!AUDIO_EXT.test(file.name)) return setMsg('mp3·m4a·wav·ogg 녹음 파일만 됩니다.')
    setMsg(undefined)
    setPct(0)
    setBusy(file.name)
    cancelled.current = false
    try {
      const wav = DIRECT_EXT.test(file.name) ? undefined : await toWav16k(file)
      if (cancelled.current) return
      const r = wav ? await bridge.run({ wav, model }) : await bridge.run({ path: bridge.pathOf(file), model })
      if (cancelled.current) return
      if (r.text.trim()) onText(r.text)
      else setMsg('받아쓴 글이 없습니다(말소리가 없거나 너무 작습니다).')
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setMsg(m === '그만두었습니다.' ? undefined : m)
    } finally {
      setBusy(null)
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void take(e.dataTransfer?.files?.[0])
  }

  return (
    <section
      className={`audio-drop${over ? ' over' : ''}`}
      aria-label="녹음 파일"
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {busy ? (
        <div className="stack">
          <span>{`${busy} 받아쓰는 중… ${pct}%`}</span>
          <div className="row">
            <progress role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} max={100} value={pct} />
            <button type="button" onClick={() => { cancelled.current = true; setBusy(null); void bridge.cancel() }}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="link" onClick={() => input.current?.click()}>
          🎙 녹음 파일을 끌어다 놓거나 눌러 고르세요 (mp3·m4a·wav·ogg) · 이 컴퓨터 안에서만 글로 바꿉니다
        </button>
      )}
      <input ref={input} type="file" accept=".mp3,.m4a,.wav,.ogg,.flac,.aac,.webm,audio/*" hidden onChange={(e) => { void take(e.target.files?.[0]); e.target.value = '' }} />
      {msg && <p className="error" role="alert">{msg}</p>}
    </section>
  )
}
