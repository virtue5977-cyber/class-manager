import type { NoteBlock } from '../db/types'
import { lineHtml, noteToHtml, noteToPlain } from './toHtml'

const blocks: NoteBlock[] = [
  { id: '1', type: 'h1', text: '11월 안내' },
  { id: '2', type: 'p', text: '중요한 글입니다', marks: [{ b: true, u: true, from: 0, to: 3 }, { color: '#c0392b', font: '함초롬바탕', from: 4, to: 6 }] },
  { id: '3', type: 'number', text: '첫째' },
  { id: '4', type: 'number', text: '둘째', indent: 1 },
  { id: '5', type: 'bullet', text: '점' },
  { id: '6', type: 'check', text: '동의서', checked: true },
  { id: '7', type: 'check', text: '회신', checked: false },
  { id: '8', type: 'roster', text: '제출', rows: [{ sid: 'a', label: '1번 가상일', checked: true }] },
]

test('한글용 HTML: 제목 크기·굵기, 서식 태그와 글꼴·색, 목록 기호는 글자로, 체크는 ☑/☐, 표는 테두리', () => {
  const h = noteToHtml({ title: '회의', blocks })
  expect(h).toContain('<!--StartFragment-->')
  expect(h).toContain('font-size:18pt;line-height:160%;margin:0;font-weight:bold">회의</p>')
  expect(h).toContain('font-size:16pt')
  expect(h).toContain('<b><u>중요한</u></b>')
  expect(h).toContain(`<span style="color:#c0392b;font-family:'함초롬바탕'">글입</span>`)
  expect(h).toContain('1. 첫째')
  expect(h).toContain('가. 둘째')
  expect(h).toContain('margin-left:40pt')
  expect(h).toContain('• 점')
  expect(h).toContain('☑ <s>동의서</s>')
  expect(h).toContain('☐ 회신')
  expect(h).toMatch(/<table style="border-collapse:collapse;border:1px solid #000"><tr><td[^>]*>1번 가상일<\/td><td[^>]*>✔<\/td><\/tr><\/table>/)
})

test('글 안 줄바꿈과 꺾쇠는 안전하게', () => {
  expect(lineHtml('a<b>\n둘')).toBe('a&lt;b&gt;<br>둘')
})

test('서식 없는 글', () => {
  expect(noteToPlain({ title: '회의', blocks: blocks.slice(2, 7) })).toBe('회의\n1. 첫째\n  가. 둘째\n• 점\n☑ 동의서\n☐ 회신')
})

test('정렬·줄 간격·pt가 한글용 HTML에', () => {
  const h = noteToHtml({ title: '', blocks: [{ id: 'a', type: 'p', text: '가운데 큰', align: 'center', line: 200, marks: [{ from: 4, to: 5, pt: 14 }] }] })
  expect(h).toContain('text-align:center')
  expect(h).toContain('line-height:200%')
  expect(h).toContain('font-size:14pt')
})
