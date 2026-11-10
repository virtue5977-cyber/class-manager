import { expect, test } from 'vitest'
import { gridNext } from './gridNav'

// 4칸씩 3줄(마지막 줄 2칸): 위치(top)만으로 칸 수를 알아낸다.
const tops = [0, 0, 0, 0, 60, 60, 60, 60, 120, 120]

test('아래·위 방향키는 한 줄씩, 왼쪽·오른쪽은 한 칸씩 움직인다', () => {
  expect(gridNext(tops, 1, 'ArrowDown')).toBe(5)
  expect(gridNext(tops, 5, 'ArrowUp')).toBe(1)
  expect(gridNext(tops, 5, 'ArrowRight')).toBe(6)
  expect(gridNext(tops, 5, 'ArrowLeft')).toBe(4)
})

test('끝을 넘어가지 않고, 아래 줄에 칸이 없으면 마지막 학생으로 간다', () => {
  expect(gridNext(tops, 0, 'ArrowUp')).toBe(0)
  expect(gridNext(tops, 7, 'ArrowDown')).toBe(9)
  expect(gridNext(tops, 9, 'ArrowRight')).toBe(9)
  expect(gridNext(tops, 0, 'ArrowLeft')).toBe(0)
})

test('지금 고른 칸이 없으면 첫 칸, 다른 키는 무시한다', () => {
  expect(gridNext(tops, -1, 'ArrowDown')).toBe(0)
  expect(gridNext(tops, 2, 'Enter')).toBeNull()
})

test('위치를 모르면(모두 같은 줄) 한 칸씩 움직인다', () => {
  expect(gridNext([0, 0, 0], 0, 'ArrowDown')).toBe(1)
})
