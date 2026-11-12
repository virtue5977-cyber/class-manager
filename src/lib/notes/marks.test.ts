import { applyStyle, joinMarks, segments, shiftLinks, shiftMarks, splitLinks, splitRanges, styleAt, type Mark } from './marks'

test('applyStyle: 켜고 다시 주면 끈다, 겹치면 나뉘고 같으면 합친다', () => {
  let m = applyStyle([], 6, 0, 3, 'b')
  expect(m).toEqual([{ b: true, from: 0, to: 3 }])
  m = applyStyle(m, 6, 2, 5, 'u')
  expect(m).toEqual([{ b: true, from: 0, to: 2 }, { b: true, u: true, from: 2, to: 3 }, { u: true, from: 3, to: 5 }])
  m = applyStyle(m, 6, 0, 3, 'b')
  expect(m).toEqual([{ u: true, from: 2, to: 5 }])
  expect(applyStyle([], 4, 1, 3, 'color', '#c0392b')).toEqual([{ color: '#c0392b', from: 1, to: 3 }])
  expect(applyStyle([{ color: '#c0392b', from: 1, to: 3 }], 4, 1, 3, 'color', '#c0392b')).toEqual([])
})

test('styleAt: 범위 안 공통 서식, 커서만 있으면 앞 글자', () => {
  const m: Mark[] = [{ b: true, from: 0, to: 4 }, { u: true, from: 2, to: 4 }]
  expect(styleAt(m, 6, 0, 4)).toEqual({ b: true })
  expect(styleAt(m, 6, 3, 3)).toEqual({ b: true, u: true })
})

test('shiftMarks: 앞에 넣으면 밀고, 굵은 글 끝에 이어 쓰면 굵게, 지우면 줄인다', () => {
  const m: Mark[] = [{ b: true, from: 2, to: 4 }]
  expect(shiftMarks(m, '가나다라마', 'XY가나다라마')).toEqual([{ b: true, from: 4, to: 6 }])
  expect(shiftMarks(m, '가나다라마', '가나다라Z마')).toEqual([{ b: true, from: 2, to: 5 }])
  expect(shiftMarks(m, '가나다라마', '가나마')).toEqual([])
  expect(shiftMarks(m, '가나다라마', '가나라마')).toEqual([{ b: true, from: 2, to: 3 }])
  // 굵은 글자를 골라 다른 글로 바꿔 쓰면 굵게 남는다
  expect(shiftMarks(m, '가나다라마', '가나ABC마')).toEqual([{ b: true, from: 2, to: 5 }])
})

test('shiftLinks: 링크 앞에 넣으면 밀고, 링크 끝에 이어 쓴 글은 링크가 아니며, 링크 안을 고치면 없앤다', () => {
  const l = [{ from: 3, to: 7, note: 'n1' }]
  expect(shiftLinks(l, '보기 @회의록 끝', '자 보기 @회의록 끝')).toEqual([{ from: 5, to: 9, note: 'n1' }])
  expect(shiftLinks(l, '보기 @회의록 끝', '보기 @회의록를 끝')).toEqual(l)
  expect(shiftLinks(l, '보기 @회의록 끝', '보기 @회의 끝')).toEqual([])
})

test('나누기·합치기: 서식이 따라간다, 링크는 나누는 자리에 걸리면 없앤다', () => {
  const [a, b] = splitRanges<Mark>([{ b: true, from: 1, to: 5 }], 3)
  expect(a).toEqual([{ b: true, from: 1, to: 3 }])
  expect(b).toEqual([{ b: true, from: 0, to: 2 }])
  expect(joinMarks(a, '가나다', b, '라마바')).toEqual([{ b: true, from: 1, to: 5 }])
  expect(splitLinks([{ from: 2, to: 6, note: 'x' }], 4)).toEqual([[], []])
  expect(splitLinks([{ from: 0, to: 2, note: 'x' }], 4)).toEqual([[{ from: 0, to: 2, note: 'x' }], []])
})

test('segments: 서식·링크가 같은 글자끼리 조각', () => {
  expect(segments('가나다라', [{ b: true, from: 1, to: 3 }], [{ from: 3, to: 4, note: 'n' }])).toEqual([
    { text: '가', from: 0, style: {} },
    { text: '나다', from: 1, style: { b: true } },
    { text: '라', from: 3, style: {}, link: 'n' },
  ])
})

test('같은 글자가 이어져도 커서 자리로 서식을 옮긴다(가가·띄어쓰기 둘·붙여넣기)', () => {
  const b = [{ from: 0, to: 1, b: true }]
  // 굵은 첫 '가'를 지우면(커서 0) 남은 '가'는 보통
  expect(shiftMarks(b, '가가', '가', 0)).toEqual([])
  // 굵은 '가' 바로 뒤에 '가'를 치면(커서 2) 앞 글자 서식을 잇는다
  expect(shiftMarks(b, '가가', '가가가', 2)).toEqual([{ from: 0, to: 2, b: true }])
  // 굵은 띄어쓰기(1)를 지우면 다른 띄어쓰기는 보통
  expect(shiftMarks([{ from: 1, to: 2, b: true }], 'a  b', 'a b', 1)).toEqual([])
  // 'ab' 뒤에 'ab'를 붙여 넣으면(커서 4) 새 글은 앞 글자 서식, 원래 글은 그대로
  expect(shiftMarks([{ from: 0, to: 1, u: true }], 'ab', 'abab', 4)).toEqual([{ from: 0, to: 1, u: true }])
  expect(shiftLinks([{ from: 0, to: 2, note: 'n' }], 'ab', 'abab', 4)).toEqual([{ from: 0, to: 2, note: 'n' }])
})

test('이상한 서식 값·링크 id는 버린다(HTML에 끼어들지 못하게)', () => {
  const bad = [{ from: 0, to: 2, font: `x' onmouseover="alert(1)`, color: 'red" onclick="x', bg: '#fff59d', size: 'huge', b: 'yes' } as unknown as Mark]
  const seg = segments('가나', bad, [{ from: 0, to: 2, note: 'a" onclick="x' }])
  expect(seg).toEqual([{ text: '가나', from: 0, style: { bg: '#fff59d' } }])
  expect(segments('가', [{ from: 0, to: 1, font: '궁서', color: '#c0392b', size: 'lg', b: true }])[0].style).toEqual({ b: true, color: '#c0392b', font: '궁서', size: 'lg' })
})
