import { appendTranscript, encodeWav16, getSttBridge } from './stt'

test('encodeWav16: 16kHz 모노 PCM16 WAV', () => {
  const b = encodeWav16(new Float32Array([0, 1, -1]))
  expect(b.length).toBe(44 + 6)
  const t = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n))
  expect(t(0, 4)).toBe('RIFF')
  expect(t(8, 4)).toBe('WAVE')
  const v = new DataView(b.buffer)
  expect(v.getUint16(22, true)).toBe(1)
  expect(v.getUint32(24, true)).toBe(16000)
  expect(v.getUint16(34, true)).toBe(16)
  expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768])
})

test('appendTranscript: 쓰던 내용 뒤에 이어 붙임', () => {
  expect(appendTranscript('', ' 안녕 ')).toBe('안녕')
  expect(appendTranscript('메모', '안녕')).toBe('메모\n\n[녹음 받아쓰기]\n안녕')
  expect(appendTranscript('메모', '  ')).toBe('메모')
})

test('브리지가 없으면 undefined', () => {
  expect(getSttBridge()).toBeUndefined()
})
