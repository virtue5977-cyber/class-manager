import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, listStudents } from '../../lib/roster/roster'
import { writeSimpleXlsx } from '../../lib/xlsx/simple'
import { readFirstSheet } from '../../lib/xlsx/read'
import RosterTab from './RosterTab'

test('나이스 명렬표 올리기 → 양식 내려받기(명단 채워짐) → 양식으로 보호자 정보만 덧붙이기', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const fs = createMemoryFsAdapter()
  render(<AppProviders db={db} fs={fs}><RosterTab classId={c.id} classLabel="1학년 5반" /></AppProviders>)
  fs.nextFileToRead = { name: '명렬표.xlsx', bytes: await writeSimpleXlsx('s', [['학년', '반', '번호', '성명', '비고'], ['1', '5', '1', '가나', ''], ['1', '5', '2', '다라', '']]) }
  await user.click(await screen.findByRole('button', { name: '엑셀 파일 올리기' }))
  expect(await screen.findByText('올린 파일: 명렬표.xlsx')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '등록' }))
  expect(await screen.findByText('새로 2명, 갱신 0명을 등록했습니다.')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '양식 내려받기' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['명렬표_양식_1학년5반.xlsx']))
  const sheet = await readFirstSheet(fs.downloads[0].bytes)
  expect(sheet[0]).toEqual(['번호', '이름', '성별', '생년월일', '전화번호', '보호자 이름', '보호자 관계', '보호자 연락처'])
  sheet[1][5] = '김보호'
  sheet[1][6] = '어머니'
  sheet[1][7] = '01011112222'
  sheet[2][1] = ''
  fs.nextFileToRead = { name: '양식.xlsx', bytes: await writeSimpleXlsx('s', sheet) }
  await user.click(screen.getByRole('button', { name: '엑셀 파일 올리기' }))
  await user.click(await screen.findByRole('button', { name: '등록' }))
  expect(await screen.findByText('새로 0명, 갱신 1명을 등록했습니다.')).toBeInTheDocument()
  const list = await listStudents(db, c.id)
  expect(list.map((s) => [s.name, s.guardian_name, s.guardian_relation, s.guardian_phone])).toEqual([
    ['가나', '김보호', '어머니', '010-1111-2222'],
    ['다라', '', '', ''],
  ])
})
