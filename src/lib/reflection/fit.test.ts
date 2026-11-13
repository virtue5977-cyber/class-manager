// @vitest-environment node
import JSZip from 'jszip'
import { charEm } from './widths'
import { fitLine, linesFit, MODES, widthPt, bodyOpts } from './fit'
import { distribute, splitSentences } from './split'
import { buildReflectionHwpx } from './hwpx'
import { DEFAULT_LINES, DEFAULT_T1, DEFAULT_T2 } from './store'

test('글자 폭 표: 한글 1, 공백·숫자·영문은 좁게', () => {
  expect(charEm('가')).toBe(1)
  expect(charEm(' ')).toBeLessThan(0.5)
  expect(charEm('a')).toBeLessThan(charEm('A'))
  expect(charEm('漢')).toBe(1)
})

test('B4 폭과 맞춤: 기본 1번 문장은 한 줄에 들어가고(넘침 아님), 너무 긴 줄은 넘침', () => {
  expect(widthPt('B4')).toBeCloseTo(((65174 - 282) / 100) * 0.985, 3)
  expect(widthPt('A4')).toBeLessThan(widthPt('B4'))
  const r = fitLine('1. ' + DEFAULT_LINES[0], bodyOpts('B4'))
  expect(r.over).toBe(false)
  expect(['ok', 'sp']).toContain(r.state) // 1번 기본 문장을 줄여 글자 크기를 줄이지 않는다(11/11)
  const long = fitLine('1. ' + '가'.repeat(120), bodyOpts('B4'))
  expect(long.over).toBe(true)
  expect(long.overChars).toBeGreaterThan(0)
  expect(fitLine('짧은 줄', bodyOpts('B4'))).toMatchObject({ state: 'ok', pt: 12, sp: 0 })
})

test('영문·숫자가 섞이면 같은 글자 수의 한글보다 좁게 계산', () => {
  const ko = fitLine('가'.repeat(60), bodyOpts('B4'))
  const mix = fitLine('가'.repeat(30) + 'abc 123 '.repeat(4) + '가가', bodyOpts('B4'))
  expect(mix.natural).toBeLessThan(ko.natural)
})

test('16줄 맞춤 결과', () => {
  const fits = linesFit(DEFAULT_LINES, 'B4')
  expect(fits).toHaveLength(16)
  expect(fits.every((f) => !f.over)).toBe(true)
  expect(MODES.A4.k).toBeCloseTo(0.7956)
})

test('문장 나누기: 번호 지우고 문장 단위, 긴 문장은 줄에 맞게 나눔', () => {
  expect(splitSentences('1. 첫 문장입니다. 2. 둘째 문장입니다!\n셋째')).toEqual(['첫 문장입니다.', '둘째 문장입니다!', '셋째'])
  const lines = distribute('짧은 문장입니다. ' + '아주 긴 문장 '.repeat(30) + '끝입니다.', 'B4')
  expect(lines[0]).toBe('짧은 문장입니다.')
  expect(lines.length).toBeGreaterThan(2)
  for (const [i, l] of lines.entries()) expect(fitLine(`${i + 1}. ${l}`, bodyOpts('B4')).over).toBe(false)
})

test('한글 파일: 날짜·학번·이름·16줄이 들어가고 A4는 쪽 크기를 줄인다', async () => {
  const lines = [...DEFAULT_LINES]
  const bytes = await buildReflectionHwpx({ date: '2026.11.10.', no: '10503', name: '박도윤', t1: DEFAULT_T1, t2: DEFAULT_T2, lines, mode: 'B4' })
  const z = await JSZip.loadAsync(bytes)
  const sec = await z.file('Contents/section0.xml')!.async('string')
  expect(sec).toContain('박도윤')
  expect(sec).toContain('10503')
  expect(sec).toContain('2026.11.10.')
  expect(sec).toContain(lines[15])
  expect(await z.file('mimetype')!.async('string')).toBe('application/hwp+zip')
  const a4 = await JSZip.loadAsync(await buildReflectionHwpx({ date: '', no: '', name: '', t1: DEFAULT_T1, t2: DEFAULT_T2, lines, mode: 'A4' }))
  expect(await a4.file('Contents/section0.xml')!.async('string')).toContain(`width="${MODES.A4.pageW}" height="${MODES.A4.pageH}"`)
})

test('넓은 영문(W·M·m·w)은 넓게 잡고, 줄 글의 $&는 그대로 들어간다', async () => {
  expect(charEm('W')).toBeGreaterThanOrEqual(0.9)
  expect(charEm('m')).toBeGreaterThanOrEqual(0.8)
  const lines = [...DEFAULT_LINES]
  lines[3] = '가격 $& 표시'
  const z = await JSZip.loadAsync(await buildReflectionHwpx({ date: '', no: '', name: '', t1: DEFAULT_T1, t2: DEFAULT_T2, lines, mode: 'B4' }))
  expect(await z.file('Contents/section0.xml')!.async('string')).toContain('가격 $&amp; 표시')
})

test('붙여 넣은 글의 제어 문자는 한글 파일에서 빠진다(파일이 깨지지 않게)', async () => {
  const lines = [...DEFAULT_LINES]
  lines[0] = '앞\u0001\u000B뒤'
  const z = await JSZip.loadAsync(await buildReflectionHwpx({ date: '', no: '', name: '이\u0007름', t1: DEFAULT_T1, t2: DEFAULT_T2, lines, mode: 'B4' }))
  const sec = await z.file('Contents/section0.xml')!.async('string')
  expect(sec).toContain('앞뒤')
  expect(sec).toContain('이름')
  expect(sec).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/)
})

test('첫 줄이 다음 줄로 넘어가지 않게: 기본 1번 줄은 글자를 줄이지 않고도 한 줄, 한글 파일의 줄 칸은 넘치면 눌러 담기(SQUEEZE)', async () => {
  expect(fitLine(`1. ${DEFAULT_LINES[0]}`, bodyOpts('B4')).over).toBe(false)
  expect(fitLine(`1. ${DEFAULT_LINES[0]}`, bodyOpts('B4')).state).not.toBe('pt')
  const lines = [...DEFAULT_LINES]
  lines[0] = '아주 긴 줄 '.repeat(20)
  const z = await JSZip.loadAsync(await buildReflectionHwpx({ date: '', no: '', name: '', t1: DEFAULT_T1, t2: DEFAULT_T2, lines, mode: 'B4' }))
  const sec = await z.file('Contents/section0.xml')!.async('string')
  const rows = sec.match(/<hp:tr>[\s\S]*?<\/hp:tr>/g)!
  for (let i = 0; i < 16; i++) expect(rows[2 + i * 2]).not.toMatch(/lineWrap="BREAK"/)
})

test('줄마다 자간을 손으로 정하면(자동 대신) 그 자간으로, 넘치면 넘침 표시', async () => {
  const { lineFit } = await import('./fit')
  const auto = lineFit('1. 짧은 문장', 'B4', undefined, null)
  expect(auto.sp).toBe(0)
  const m = lineFit('1. 짧은 문장', 'B4', undefined, -8)
  expect([m.sp, m.over]).toEqual([-8, false])
  const long = lineFit(`1. ${'가'.repeat(120)}`, 'B4', undefined, 5)
  expect(long.over).toBe(true)
})
