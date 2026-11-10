import { addField, DEFAULT_FIELDS, fieldValue, moveField, readFields, removeField, renameField, setFieldValue, templateColumns } from './fields'
import { emptyStudent } from './roster'
import type { StudentRec } from '../db/types'

test('기본 양식: 이름 뺀 13칸, 성별부터', () => {
  const f = readFields({})
  expect(f).toHaveLength(13)
  expect(f[0]).toEqual({ key: 'gender', label: '성별', builtin: true, visible: true })
  expect(f.map((x) => x.key)).toContain('memo')
})

test('칸 추가·이름 바꾸기·순서·지우기(기본 칸은 못 지움)', () => {
  let f = addField(DEFAULT_FIELDS, '방과후')
  const x = f[f.length - 1]
  expect(x).toMatchObject({ label: '방과후', builtin: false, visible: true })
  expect(x.key).toMatch(/^x_[a-z0-9]{8}$/)
  f = renameField(f, x.key, '방과후 학교')
  expect(f[f.length - 1].label).toBe('방과후 학교')
  const moved = moveField(f, 'phone', -1)
  expect(moved.findIndex((y) => y.key === 'phone')).toBeLessThan(moved.findIndex((y) => y.key === 'birth_date'))
  expect(removeField(f, 'gender')).toEqual(f)
  expect(removeField(f, x.key).some((y) => y.key === x.key)).toBe(false)
})

test('저장값 합치기: 저장 순서·숨김·이름 그대로, 새 기본 칸은 뒤에, 모르는 기본 칸은 버림', () => {
  const f = readFields({ roster_fields: [{ key: 'memo', label: '메모', builtin: true, visible: false }, { key: 'nope', label: '?', builtin: true, visible: true }] })
  expect(f[0]).toEqual({ key: 'memo', label: '메모', builtin: true, visible: false })
  expect(f).toHaveLength(13)
  expect(f.some((x) => x.key === 'nope')).toBe(false)
})

test('엑셀 열: 번호·이름 + 보이는 칸, 추가 칸은 이름이 별칭', () => {
  const f = addField(readFields({ roster_fields: [...DEFAULT_FIELDS.map((x) => (x.key === 'gender' ? { ...x, visible: false } : x))] }), '알레르기')
  const cols = templateColumns(f)
  expect(cols.slice(0, 2).map((c) => c.key)).toEqual(['number', 'name'])
  expect(cols.some((c) => c.key === 'gender')).toBe(false)
  expect(cols[cols.length - 1].aliases).toEqual(['알레르기'])
  expect(cols.find((c) => c.key === 'phone')!.aliases).toContain('연락처')
})

test('값 읽고 쓰기: 기본 칸은 학생 칸, 추가 칸은 extra', () => {
  const f = addField(DEFAULT_FIELDS, '알레르기')
  const x = f[f.length - 1]
  let st = emptyStudent(1, '가')
  st = setFieldValue(st, x, '땅콩')
  st = setFieldValue(st, f[0], '여')
  expect(st.extra).toEqual({ [x.key]: '땅콩' })
  expect(st.gender).toBe('여')
  expect(fieldValue(st as StudentRec, x)).toBe('땅콩')
})

test('추가 칸 이름이 기본 칸 이름·별칭이나 다른 칸과 겹치면 알린다(다시 올릴 때 값이 섞이지 않게)', async () => {
  const { fieldLabelProblem } = await import('./fields')
  const f = addField(DEFAULT_FIELDS, '방과후')
  expect(fieldLabelProblem(f, '취미')).toBe("'취미'은(는) 이미 있는 칸 이름입니다.")
  expect(fieldLabelProblem(f, '연락처')).toBe("'연락처'은(는) 기본 칸(전화번호)을 엑셀에서 찾는 이름이라 쓸 수 없습니다.")
  expect(fieldLabelProblem(f, ' 방과 후 ')).toBe("'방과 후'은(는) 이미 있는 칸 이름입니다.")
  expect(fieldLabelProblem(f, '방과후', f[f.length - 1].key)).toBeUndefined() // 자기 이름은 괜찮다
  expect(fieldLabelProblem(f, '번호')).toBe("'번호'은(는) 이미 있는 칸 이름입니다.")
  expect(fieldLabelProblem(f, '')).toBe('칸 이름을 쓰세요.')
  expect(fieldLabelProblem(f, '알레르기')).toBeUndefined()
})
