import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import RosterTab from './RosterTab'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, { ...emptyStudent(1, '가나'), phone: '010-1111' })
  await saveStudent(db, c.id, { ...emptyStudent(2, '다라'), active: false })
  await saveStudent(db, c.id, emptyStudent(3, '마바'))
  render(<AppProviders db={db} fs={createMemoryFsAdapter()}><RosterTab classId={c.id} /></AppProviders>)
  return { db, c }
}
const list = () => screen.getByRole('list', { name: '학생 명단' })
const items = () => within(list()).getAllByRole('button')

test('왼쪽 목록은 "1번 가나"만, 처음엔 첫 학생 상세가 오른쪽에 열린다', async () => {
  await setup()
  await waitFor(() => expect(items()).toHaveLength(3))
  expect(items()[0]).toHaveTextContent(/^1번 가나$/)
  expect(within(list()).queryByText('010-1111')).not.toBeInTheDocument()
  const form = screen.getByRole('form', { name: '학생 정보' })
  expect(within(form).getByRole('heading')).toHaveTextContent('1번 가나')
  expect(items()[0]).toHaveAttribute('aria-current', 'true')
})

test('전출 학생은 맨 아래에 inactive로', async () => {
  await setup()
  await waitFor(() => expect(items()).toHaveLength(3))
  expect(items().map((b) => b.textContent)).toEqual(['1번 가나', '3번 마바', '2번 다라(전출)'])
  expect(items()[2]).toHaveClass('inactive')
})

test('찾기 칸에 "다라" → 목록 1명, 누르면 그 학생 상세', async () => {
  const user = userEvent.setup()
  await setup()
  await waitFor(() => expect(items()).toHaveLength(3))
  await user.type(screen.getByRole('searchbox', { name: '학생 찾기' }), '다라')
  expect(items()).toHaveLength(1)
  await user.click(items()[0])
  expect(within(screen.getByRole('form', { name: '학생 정보' })).getByRole('heading')).toHaveTextContent('2번 다라')
})

test('양식 고치기: 칸 추가·숨기기·순서, 상세가 따라가고 숨겨도 값은 남는다', async () => {
  const user = userEvent.setup()
  const { db } = await setup()
  await screen.findByRole('form', { name: '학생 정보' })
  await user.click(screen.getByText('가져오기·양식 ▾'))
  await user.click(screen.getByRole('button', { name: '양식 고치기' }))
  const ed = screen.getByRole('region', { name: '명단 양식 고치기' })
  await user.type(within(ed).getByLabelText('새 칸 이름'), '알레르기')
  await user.click(within(ed).getByRole('button', { name: '칸 추가' }))
  await user.click(within(ed).getByRole('checkbox', { name: '전화번호 보이기' }))
  await user.click(within(ed).getByRole('button', { name: '생년월일 위로' }))
  await user.click(within(ed).getByRole('button', { name: '저장' }))
  const form = await screen.findByRole('form', { name: '학생 정보' })
  await waitFor(() => expect(within(form).getByLabelText('알레르기')).toBeInTheDocument())
  expect(within(form).queryByLabelText('전화번호')).toBeNull()
  const labels = within(form).getAllByText(/^(성별|생년월일)$/).map((x) => x.textContent)
  expect(labels[0]).toBe('생년월일')
  await user.type(within(form).getByLabelText('알레르기'), '땅콩')
  await user.click(within(form).getByRole('button', { name: '저장' }))
  await waitFor(async () => {
    const s = (await db.students.toArray()).find((x) => x.name === '가나')!
    expect(Object.values(s.extra ?? {})).toEqual(['땅콩'])
    expect(s.phone).toBe('010-1111')
  })
})
