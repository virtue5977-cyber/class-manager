import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, setCurrentClassId, emptyStudent, saveStudent } from '../../lib/roster/roster'
import ClassPage from './ClassPage'

const fresh = () => createDb('test-' + crypto.randomUUID())
const renderPage = (db: AppDB, sub: 'roster' | 'sheet' | 'seating' | 'cleaning' = 'roster') =>
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <ClassPage sub={sub} />
    </AppProviders>,
  )

async function withClass() {
  const db = fresh()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  return { db, c }
}

const rosterRows = () => within(screen.getByRole('table', { name: '학생 명단' })).getAllByRole('row').slice(1)

test('학급이 없으면 안내 문구, 학급 추가 후 선택된다', async () => {
  const user = userEvent.setup()
  renderPage(fresh())
  expect(await screen.findByText('먼저 학급을 추가하세요.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '학급 추가' }))
  await user.clear(screen.getByLabelText('학년'))
  await user.type(screen.getByLabelText('학년'), '1')
  await user.clear(screen.getByLabelText('반'))
  await user.type(screen.getByLabelText('반'), '5')
  await user.click(screen.getByRole('button', { name: '추가' }))
  await waitFor(() => expect((screen.getByLabelText('학급 선택') as HTMLSelectElement).selectedOptions[0].textContent).toMatch(/1학년 5반$/))
  expect(screen.queryByText('먼저 학급을 추가하세요.')).not.toBeInTheDocument()
})

test('붙여넣기 미리보기에 2명이 보이고 등록하면 명단에 번호순으로 나온다', async () => {
  const user = userEvent.setup()
  const { db } = await withClass()
  renderPage(db)
  await user.click(await screen.findByRole('button', { name: '엑셀에서 붙여넣기' }))
  await user.click(screen.getByLabelText('엑셀에서 복사한 내용'))
  await user.paste('번호\t이름\t보호자 성함\t보호자 번호\n2\t나\t\t\n1\t가\t보호\t010-1')
  expect(within(screen.getByRole('table', { name: '붙여넣기 미리보기' })).getAllByRole('row')).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: '등록' }))
  expect(await screen.findByText('새로 2명, 갱신 0명을 등록했습니다.')).toBeInTheDocument()
  await waitFor(() => expect(rosterRows().map((r) => r.textContent)).toEqual(['1가보호010-1', '2나']))
})

test('오류가 있으면 줄 번호와 함께 보이고 등록 버튼이 비활성', async () => {
  const user = userEvent.setup()
  const { db } = await withClass()
  renderPage(db)
  await user.click(await screen.findByRole('button', { name: '엑셀에서 붙여넣기' }))
  await user.click(screen.getByLabelText('엑셀에서 복사한 내용'))
  await user.paste('1\t가\nx\t나')
  expect(screen.getByText('2번째 줄: 번호는 1 이상의 정수여야 합니다.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
})

test('같은 내용을 다시 등록하면 "새로 0명, 갱신 2명"', async () => {
  const user = userEvent.setup()
  const { db } = await withClass()
  renderPage(db)
  for (const expected of ['새로 2명, 갱신 0명을 등록했습니다.', '새로 0명, 갱신 2명을 등록했습니다.']) {
    await user.click(await screen.findByRole('button', { name: '엑셀에서 붙여넣기' }))
    await user.click(screen.getByLabelText('엑셀에서 복사한 내용'))
    await user.paste('1\t가\n2\t나')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText(expected)).toBeInTheDocument()
  }
  await waitFor(() => expect(rosterRows()).toHaveLength(2))
})

test('학생 상세에서 재적을 해제하면 명단에 (전출) 표시', async () => {
  const user = userEvent.setup()
  const { db, c } = await withClass()
  await saveStudent(db, c.id, emptyStudent(1, '가'))
  renderPage(db)
  await user.click(await screen.findByText('가'))
  await user.click(screen.getByLabelText('재적'))
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('(전출)')).toBeInTheDocument()
  expect(rosterRows()[0]).toHaveClass('inactive')
})

test('같은 번호로 학생 추가 시 오류 문구', async () => {
  const user = userEvent.setup()
  const { db, c } = await withClass()
  await saveStudent(db, c.id, emptyStudent(1, '가'))
  renderPage(db)
  await user.click(await screen.findByRole('button', { name: '학생 추가' }))
  await user.type(screen.getByLabelText('번호'), '1')
  await user.type(screen.getByLabelText('이름'), '나')
  await user.click(screen.getByRole('button', { name: '저장' }))
  expect(await screen.findByText('같은 번호의 학생이 이미 있습니다.')).toBeInTheDocument()
})

test('학생 삭제는 화면 안 확인 후 실행된다', async () => {
  const user = userEvent.setup()
  const { db, c } = await withClass()
  await saveStudent(db, c.id, emptyStudent(1, '가'))
  renderPage(db)
  await user.click(await screen.findByText('가'))
  await user.click(screen.getByRole('button', { name: '삭제' }))
  expect(screen.getByText('이 학생을 삭제할까요?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '삭제 확인' }))
  await waitFor(() => expect(screen.queryByText('가')).not.toBeInTheDocument())
})

test('선택한 학급이 다시 열어도 유지된다', async () => {
  const db = fresh()
  await createClass(db, { school_year: 2026, grade: 1, class_no: 1 })
  const c2 = await createClass(db, { school_year: 2026, grade: 1, class_no: 2 })
  await setCurrentClassId(db, c2.id)
  renderPage(db)
  await waitFor(() => expect((screen.getByLabelText('학급 선택') as HTMLSelectElement).value).toBe(c2.id))
})

test('자리배치·청소배치 하위 화면이 열린다', async () => {
  const { db } = await withClass()
  const a = renderPage(db, 'seating')
  expect(await screen.findByRole('grid', { name: '자리배치' })).toBeInTheDocument()
  a.unmount()
  renderPage(db, 'cleaning')
  expect(await screen.findByRole('button', { name: '구역(줄) 추가' })).toBeInTheDocument()
})

test('번호가 같은데 이름이 다르면 이름 변경을 보여주고 확인해야 등록된다', async () => {
  const user = userEvent.setup()
  const { db, c } = await withClass()
  await saveStudent(db, c.id, emptyStudent(1, '가'))
  renderPage(db)
  await user.click(await screen.findByRole('button', { name: '엑셀에서 붙여넣기' }))
  await user.click(screen.getByLabelText('엑셀에서 복사한 내용'))
  await user.paste('1\t나')
  expect(screen.getByText('이름 변경: 가 → 나')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
  await user.click(screen.getByLabelText('이름 변경을 확인했습니다'))
  expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
})

test('붙여넣기 등록 후 열려 있던 학생 상세는 닫힌다(옛 내용으로 덮어쓰기 방지)', async () => {
  const user = userEvent.setup()
  const { db, c } = await withClass()
  await saveStudent(db, c.id, emptyStudent(1, '가'))
  renderPage(db)
  await user.click(await screen.findByText('가'))
  expect(screen.getByRole('form', { name: '학생 정보' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '엑셀에서 붙여넣기' }))
  await user.click(screen.getByLabelText('엑셀에서 복사한 내용'))
  await user.paste('1\t가\t보호자\t010-9')
  await user.click(screen.getByRole('button', { name: '등록' }))
  await screen.findByText('새로 0명, 갱신 1명을 등록했습니다.')
  expect(screen.queryByRole('form', { name: '학생 정보' })).not.toBeInTheDocument()
})
