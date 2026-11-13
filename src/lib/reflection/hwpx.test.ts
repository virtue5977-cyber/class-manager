import JSZip from 'jszip'
import { buildReflectionHwpx } from './hwpx'

test('반성문 hwpx: 줄마다 손으로 정한 자간이 글자 모양에 들어간다', async () => {
  const lines = Array.from({ length: 16 }, (_, i) => (i === 1 ? '자간을 손으로 정한 줄' : ''))
  const base = { date: '2026.11.13.', no: '10503', name: '가상', t1: '', t2: '', lines, mode: 'B4' as const }
  const header = async (spacing?: (number | null)[]) => (await JSZip.loadAsync(await buildReflectionHwpx({ ...base, spacing }))).file('Contents/header.xml')!.async('string')
  expect(await header(Array.from({ length: 16 }, (_, i) => (i === 1 ? -27 : null)))).toContain('hangul="-27"')
  expect(await header()).not.toContain('hangul="-27"')
})
