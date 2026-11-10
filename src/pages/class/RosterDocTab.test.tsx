import { render, screen, waitFor, within } from '@testing-library/react'
import { pickExport } from '../../test/exportMenu'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter, type MemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import RosterDocTab from './RosterDocTab'

async function setup() {
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(1, '가'))
  await saveStudent(db, c.id, { ...emptyStudent(2, '나'), active: false })
  const fs: MemoryFsAdapter = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs}>
      <RosterDocTab classRec={c} />
    </AppProviders>,
  )
  await screen.findByRole('table', { name: '명렬표 미리보기' })
  return { fs }
}

test('기본 제목과 빈 열 3이 채워져 있다', async () => {
  await setup()
  expect(screen.getByLabelText('제목')).toHaveValue('1학년 5반 명렬표')
  expect(screen.getByLabelText('빈 열 개수')).toHaveValue(3)
  expect(screen.getByLabelText('글자 크기')).toHaveValue('11')
})

test('hwpx로 내보내기 → 파일명 "1학년5반_명렬표.hwpx", 첫 바이트 PK', async () => {
  const user = userEvent.setup()
  const { fs } = await setup()
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads).toHaveLength(1))
  expect(fs.downloads[0].name).toBe('1학년5반_명렬표.hwpx')
  expect([...fs.downloads[0].bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
})

test('엑셀로 내보내기 → "1학년5반_명렬표.xlsx"', async () => {
  const user = userEvent.setup()
  const { fs } = await setup()
  await pickExport(user, '엑셀(xlsx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['1학년5반_명렬표.xlsx']))
})

test('PDF는 (데스크톱 다리가 없으면) window.print를 부른다', async () => {
  const user = userEvent.setup()
  const print = vi.spyOn(window, 'print').mockImplementation(() => {})
  await setup()
  await pickExport(user, 'PDF')
  expect(print).toHaveBeenCalledTimes(1)
  print.mockRestore()
})

test('전출 학생은 기본 미리보기에 없고, 포함 체크 시 보인다', async () => {
  const user = userEvent.setup()
  await setup()
  const preview = () => within(screen.getByRole('table', { name: '명렬표 미리보기' }))
  expect(preview().queryByText('나')).not.toBeInTheDocument()
  await user.click(screen.getByLabelText('전출 학생 포함'))
  expect(preview().getByText('나')).toBeInTheDocument()
})

test('빈 열 개수를 바꾸면 미리보기 열 수가 바뀐다', async () => {
  const user = userEvent.setup()
  await setup()
  await user.clear(screen.getByLabelText('빈 열 개수'))
  await user.type(screen.getByLabelText('빈 열 개수'), '1')
  expect(within(screen.getByRole('table', { name: '명렬표 미리보기' })).getAllByRole('columnheader')).toHaveLength(3)
})
