// @vitest-environment node
import { maskText, unmaskText, fixJosa, nameForms } from './mask'

test('성 뗀 이름·"지훈이" 꼴도 같은 가명으로, 전화번호·학번은 되돌릴 수 있게', () => {
  const m = maskText('민수랑 김민수가 싸움. 지훈이가 울었음. 010-1234-5678로 연락, 학번 1503', ['김민수', '박지훈'])
  expect(m.text).not.toMatch(/민수|지훈|010-1234|1503/)
  expect(m.text).toContain('[전화1]')
  expect(m.text).toContain('[번호1]')
  expect(new Set(m.text.match(/학생[A-Z]/g)).size).toBe(2)
  expect(unmaskText(m.text, m.map)).toBe('민수랑 민수가 싸움. 지훈이 울었음. 010-1234-5678로 연락, 학번 1503')
})

test('연도·금액은 가리지 않는다', () => {
  expect(maskText('2026.11.20까지 10000원 제출', []).text).toBe('2026.11.20까지 10000원 제출')
})

test('되돌릴 때 받침에 맞게 조사를 고치고, 낱말 안의 "이·나"는 건드리지 않는다', () => {
  const m = maskText('지훈, 민수', ['지훈', '민수'])
  const jh = Object.keys(m.map).find((k) => m.map[k] === '지훈')!
  const ms = Object.keys(m.map).find((k) => m.map[k] === '민수')!
  expect(unmaskText(`${jh}는 ${ms}와 놀았고 ${jh}가 ${ms}을 도움. ${jh}로 인해`, m.map)).toBe('지훈은 민수와 놀았고 지훈이 민수를 도움. 지훈으로 인해')
  expect(unmaskText(`${ms}이고 ${jh}나무 ${ms}의`, m.map)).toBe('민수이고 지훈나무 민수의')
})

test('fixJosa·nameForms', () => {
  expect(fixJosa('하늘', '으로')).toBe('로')
  expect(fixJosa('지훈', '로')).toBe('으로')
  expect(fixJosa('민수', '과')).toBe('와')
  expect(nameForms('박지훈')).toEqual(['박지훈', '지훈', '지훈이'])
  expect(nameForms('이준')).toEqual(['이준', '이준이'])
  expect(nameForms('김민수')).toEqual(['김민수', '민수'])
})

test('두 글자 성·띄어 쓴 이름·영문 이름·국제 전화번호도 가린다', () => {
  const m = maskText('민수가 지훈이랑 서연이와 Jisu, +82-10-1234-5678, 1234-5678', ['남궁민수', '황보지훈', '이 서연', 'Kim Jisu'])
  expect(m.text).not.toMatch(/민수|지훈|서연|Jisu|1234-5678/)
  expect(nameForms('남궁민수')).toEqual(expect.arrayContaining(['남궁민수', '민수']))
})

test('주민등록번호·이메일도 가리고 되돌린다', () => {
  const m = maskText('주민번호 120305-3123456, 메일 kim.ms@example.com 으로 회신', [])
  expect(m.text).not.toContain('120305')
  expect(m.text).not.toContain('example.com')
  expect(m.text).toContain('[주민1]')
  expect(m.text).toContain('[메일1]')
  expect(unmaskText(m.text, m.map)).toBe('주민번호 120305-3123456, 메일 kim.ms@example.com 으로 회신')
})

test('밖으로 보내는 글(hideForExport): 이름 ○○, 전화·주민번호·메일도 가림', async () => {
  const { hideForExport } = await import('./mask')
  expect(hideForExport('김민수 어머니 010-1234-5678, mom@example.com', ['김민수'])).toBe('○○ 어머니 [전화], [메일]')
})

test('밖으로 보내는 글: 학년도·시각 범위·ISBN은 전화·주민번호로 오인하지 않는다', async () => {
  const { hideForExport } = await import('./mask')
  expect(hideForExport('2025-2026 학년도 협의, 회의 1400-1600, 0830-0910 1교시, ISBN 9788912345678', [])).toBe('2025-2026 학년도 협의, 회의 1400-1600, 0830-0910 1교시, ISBN 9788912345678')
  expect(hideForExport('집 02-123-4567, 휴대폰 01012345678, 주민 120305-3123456', [])).toBe('집 [전화], 휴대폰 [전화], 주민 [주민]')
})

test('보호자 이름은 보호자A로 가리고(학생으로 읽히지 않게) 되돌린다', async () => {
  const { GUARDIAN_PREFIX, hideNames } = await import('./mask')
  const m = maskText('김민수 어머니 이영희 님과 통화', ['김민수', `${GUARDIAN_PREFIX}이영희`])
  expect(m.text).toBe('학생A 어머니 보호자A 님과 통화')
  expect(unmaskText(m.text, m.map)).toBe('김민수 어머니 이영희 님과 통화')
  expect(hideNames('이영희 님', [`${GUARDIAN_PREFIX}이영희`])).toBe('○○ 님')
})

test('학생과 보호자의 이름 끝이 같아도 섞지 않는다(김민수 / 보호자 이민수)', async () => {
  const { GUARDIAN_PREFIX } = await import('./mask')
  const m = maskText('민수 어머니(이민수)와 통화', ['김민수', `${GUARDIAN_PREFIX}이민수`])
  expect(m.text).toBe('학생A 어머니(보호자A)와 통화')
  expect(unmaskText(m.text, m.map)).toBe('민수 어머니(이민수)와 통화')
})
