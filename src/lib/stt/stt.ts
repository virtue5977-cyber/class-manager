/** 음성 받아쓰기(설치형 SHELL 5 이상): 녹음 파일 → 이 컴퓨터 안에서 글. */

export type SttModel = 'fast' | 'accurate' | 'best'
export interface SttStatus {
  supported: boolean
  bin: boolean
  models: SttModel[]
}
export interface SttProgress {
  phase: 'bin' | 'model' | 'run'
  received?: number
  total?: number
  percent?: number
}
export interface SttBridge {
  status(): Promise<SttStatus>
  install(model: SttModel): Promise<SttStatus>
  remove(): Promise<SttStatus>
  run(opts: { path?: string; wav?: Uint8Array; model?: SttModel }): Promise<{ text: string }>
  cancel(): Promise<void>
  onProgress(cb: (p: SttProgress) => void): () => void
  pathOf(file: File): string
}

export function getSttBridge(): SttBridge | undefined {
  return (globalThis as { desktop?: { stt?: SttBridge } }).desktop?.stt
}

export const MODEL_LABEL: Record<SttModel, string> = { fast: '빠름(약 0.2GB)', accurate: '정확(약 0.5GB)', best: '최고(약 0.55GB)' }
/** 여러 개 받아 두면 좋은 것부터 쓴다 */
export const MODEL_ORDER: SttModel[] = ['best', 'accurate', 'fast']
export const MODEL_HINT: Record<SttModel, string> = { fast: '가장 빠름, 또렷한 녹음에 알맞음', accurate: '빠름보다 정확', best: '가장 정확(large-v3-turbo), 정확보다 빠름 · 권장' }
export const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i
/** whisper가 바로 읽는 형식(파일 경로만 넘김, 메모리에 올리지 않음) */
export const DIRECT_EXT = /\.(mp3|wav|ogg|flac)$/i
const DECODE_MAX = 40 * 1024 * 1024

export function encodeWav16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const str = (i: number, s: string) => [...s].forEach((c, k) => v.setUint8(i + k, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true)
  v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  samples.forEach((x, i) => {
    const c = Math.max(-1, Math.min(1, x))
    v.setInt16(44 + i * 2, c < 0 ? Math.round(c * 32768) : Math.round(c * 32767), true)
  })
  return out
}

/** m4a·aac·webm: 브라우저로 풀어 16kHz 모노 WAV로(whisper가 못 읽는 형식). */
export async function toWav16k(file: File): Promise<Uint8Array> {
  if (file.size > DECODE_MAX) throw new Error('이 형식은 40MB까지입니다. mp3로 바꿔 올리세요.')
  const buf = await file.arrayBuffer()
  const ctx = new AudioContext()
  try {
    const audio = await ctx.decodeAudioData(buf)
    const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000)
    const src = off.createBufferSource()
    src.buffer = audio
    src.connect(off.destination)
    src.start()
    return encodeWav16((await off.startRendering()).getChannelData(0))
  } finally {
    void ctx.close()
  }
}

export function appendTranscript(content: string, text: string): string {
  const t = text.trim()
  if (!t) return content
  return content.trim() ? `${content}\n\n[녹음 받아쓰기]\n${t}` : t
}
