import { fillHeaderFooter, MARGINS, paginate } from './paginate'

test('쪽 나누기: 높이를 넘으면 다음 쪽, 강제 나눔, 쪽보다 큰 블록은 혼자 한 쪽', () => {
  expect(paginate([], [], 100)).toEqual([0])
  expect(paginate([40, 40, 40], [false, false, false], 100)).toEqual([0, 2])
  expect(paginate([40, 10, 40], [false, true, false], 100)).toEqual([0, 1])
  expect(paginate([150, 30, 30], [false, false, false], 100)).toEqual([0, 1])
  expect(paginate([30, 150, 30], [false, false, false], 100)).toEqual([0, 1, 2])
  // 강제 나눔이 연달아 와도 빈 쪽을 만들지 않는다(맨 앞 강제도 무시)
  expect(paginate([10, 10], [true, true], 100)).toEqual([0, 1])
})

test('머리말·꼬리말 바꾸기 글, 여백 값', () => {
  expect(fillHeaderFooter('- {쪽} / {전체쪽} -', 2, 5, '2026-11-12')).toBe('- 2 / 5 -')
  expect(fillHeaderFooter('{날짜} 회의', 1, 1, '2026-11-12')).toBe('2026.11.12. 회의')
  expect(MARGINS.normal).toEqual({ top: 20, bottom: 20, left: 25, right: 25 })
})
