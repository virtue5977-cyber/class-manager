// @vitest-environment node
import { parseTsv, toRosterRows, rosterTemplate } from './paste'
import { normDate, normPhone, normGender } from './columns'

const f = (o: Record<string, string> = {}) => ({ name: '', gender: '', birth_date: '', phone: '', guardian_name: '', guardian_relation: '', guardian_phone: '', ...o })

test('탭과 CRLF를 나눈다', () => expect(parseTsv('1\t가\r\n2\t나\r\n')).toEqual([['1', '가'], ['2', '나']]))

test('따옴표 셀 안의 줄바꿈과 탭, "" 이스케이프', () =>
  expect(parseTsv('1\t"김\n민"\t"a\tb"\t"말""함"\n')).toEqual([['1', '김\n민', 'a\tb', '말"함']]))

test('머리글이 없으면 양식 순서: 번호, 이름, 성별, 생년월일, 전화번호, 보호자 이름, 관계, 연락처', () => {
  const r = toRosterRows(parseTsv('1\t가\t여\t2012.3.5\t01012345678\t김보호\t어머니\t1098765432\n2\t나'))
  expect(r.rows).toEqual([
    { number: 1, fields: f({ name: '가', gender: '여', birth_date: '2012-03-05', phone: '010-1234-5678', guardian_name: '김보호', guardian_relation: '어머니', guardian_phone: '010-9876-5432' }) },
    { number: 2, fields: f({ name: '나' }) },
  ])
})

test('나이스 명렬표(학년·반·번호·성명·비고) 머리글을 알아보고 번호·이름만 읽는다', () => {
  const r = toRosterRows([['학년', '반', '번호', '성명', '비고'], ['1', '5', '1', '가', ''], ['1', '5', '2', '나', '전입']])
  expect(r.rows).toEqual([{ number: 1, fields: f({ name: '가' }) }, { number: 2, fields: f({ name: '나' }) }])
})

test('머리글 순서가 달라도, 일부 열만 있어도 그 칸만 읽는다', () => {
  const r = toRosterRows([['보호자 연락처', '번호'], ['010-1111-2222', '3']])
  expect(r.rows).toEqual([{ number: 3, fields: f({ guardian_phone: '010-1111-2222' }) }])
})

test('번호 오류·중복 번호를 줄 번호와 함께 알려준다(이름은 비어도 됨: 기존 학생 갱신용)', () => {
  const r = toRosterRows(parseTsv('1\t가\nx\t나\n3\t\n1\t다'))
  expect(r.errors).toEqual([
    { line: 2, message: '번호는 1 이상의 정수여야 합니다.' },
    { line: 4, message: '번호 1이(가) 중복됩니다.' },
  ])
  expect(r.rows.map((x) => x.number)).toEqual([1, 3])
})

test('번호 "05"·"5.0"은 5, "1.5"는 오류', () => {
  expect(toRosterRows(parseTsv('05\t가')).rows[0].number).toBe(5)
  expect(toRosterRows([['5.0', '가']]).rows[0].number).toBe(5)
  expect(toRosterRows(parseTsv('1.5\t가')).errors).toHaveLength(1)
})

test('따옴표 셀의 줄바꿈이 있어도 다음 줄 번호가 원문 줄과 맞는다', () => {
  const r = toRosterRows(parseTsv('1\t"김\n민"\nx\t나'))
  expect(r.errors).toEqual([{ line: 3, message: '번호는 1 이상의 정수여야 합니다.' }])
})

test('맨 앞의 빈 줄 다음 머리글도 건너뛴다', () => {
  const r = toRosterRows(parseTsv('\n번호\t이름\n1\t홍'))
  expect(r.rows).toEqual([{ number: 1, fields: f({ name: '홍' }) }])
})

test('값 다듬기·양식', () => {
  expect(normDate('41000')).toBe('2012-04-01')
  expect(normDate('20120305')).toBe('2012-03-05')
  expect(normPhone('010 1234 5678')).toBe('010-1234-5678')
  expect(normPhone('02-123-4567')).toBe('02-123-4567')
  expect(normGender('남자')).toBe('남')
  expect(rosterTemplate([{ number: 1, name: '가', birth_date: '', phone: '', guardian_name: '', guardian_phone: '' }])).toEqual([
    ['번호', '이름', '성별', '생년월일', '전화번호', '보호자 이름', '보호자 관계', '보호자 연락처'],
    ['1', '가', '', '', '', '', '', ''],
  ])
})
