import { choseong, matchName } from './hangul'

test('초성과 이름 찾기', () => {
  expect(choseong('박도윤')).toBe('ㅂㄷㅇ')
  expect(choseong('a박1')).toBe('aㅂ1')
  expect(matchName('ㅂㄷ', '박도윤')).toBe(true)
  expect(matchName('도윤', '박도윤')).toBe(true)
  expect(matchName('ㄷㅇ', '박도윤')).toBe(false)
  expect(matchName('김민', '김민준')).toBe(true)
})
