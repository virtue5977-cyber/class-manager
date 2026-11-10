import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb, type AppDB } from '../../lib/db/schema'
import { createMemoryFsAdapter, type MemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { getSettings } from '../../lib/settings'
import { createClass, emptyStudent, saveStudent, setCurrentClassId } from '../../lib/roster/roster'
import { saveAttendance } from '../../lib/attendance/attendance'
import { reconcileStudent, listReportsByStudent } from '../../lib/absenceReports/reconcile'
import { buildHwpx } from '../../lib/hwpx/package'
import { paragraphXml } from '../../lib/hwpx/xml'
import ReportSettings from './ReportSettings'

const fresh = () => createDb('test-' + crypto.randomUUID())
const renderWith = (db: AppDB, fs: MemoryFsAdapter = createMemoryFsAdapter()) =>
  ({ fs, ...render(<AppProviders db={db} fs={fs}><ReportSettings /></AppProviders>) })
const form = (text: string) => buildHwpx({ landscape: false, bodyXml: paragraphXml(text, { charPr: 0 }), charPrXml: [], previewText: text, title: '양식' })

test('규칙 체크를 끄면 저장하고 신고서를 다시 계산한다', async () => {
  const user = userEvent.setup()
  const db = fresh()
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await setCurrentClassId(db, c.id)
  const s = await saveStudent(db, c.id, emptyStudent(1, '가'))
  await saveAttendance(db, { student_id: s.id, date: '2026-11-06', kind: '지각', category: '출석인정', period: '1', reason: '', evidence_type: '기타', memo: '' })
  await reconcileStudent(db, s.id)
  expect(await listReportsByStudent(db, s.id)).toHaveLength(1)
  renderWith(db)
  await user.click(await screen.findByLabelText('지각 출석인정'))
  expect(await screen.findByText('신고서를 다시 계산했습니다.')).toBeInTheDocument()
  expect((await getSettings(db)).report_rules).not.toContain('지각:출석인정')
  expect(await listReportsByStudent(db, s.id)).toHaveLength(0)
})

test('학번 형식 미리보기', async () => {
  const user = userEvent.setup()
  renderWith(fresh())
  expect(await screen.findByText('1학년 5반 3번 → 1503')).toBeInTheDocument()
  await user.clear(screen.getByLabelText('학번 형식'))
  await user.type(screen.getByLabelText('학번 형식'), '{{학년}{{반2}{{번호2}')
  expect(await screen.findByText('1학년 5반 3번 → 10503')).toBeInTheDocument()
})

test('진단서 필요 일수를 저장한다', async () => {
  const user = userEvent.setup()
  const db = fresh()
  renderWith(db)
  await user.clear(await screen.findByLabelText('진단서가 필요한 결석 일수'))
  await user.type(screen.getByLabelText('진단서가 필요한 결석 일수'), '2')
  await user.tab()
  await waitFor(async () => expect((await getSettings(db)).diagnosis_days).toBe(2))
})

test('오타 표시가 있는 양식은 적용되지만 알 수 없는 표시를 알려준다', async () => {
  const user = userEvent.setup()
  const db = fresh()
  const { fs } = renderWith(db)
  fs.nextFileToRead = { name: '우리학교.hwpx', bytes: await form('{{이름}} {{이룸}}') }
  await user.click(await screen.findByRole('button', { name: '새 양식 올리기' }))
  expect(await screen.findByText('새 양식을 적용했습니다.')).toBeInTheDocument()
  expect(screen.getByText('알 수 없는 표시: {{이룸}}')).toBeInTheDocument()
  expect(screen.getByText('현재 양식: 우리학교 v1')).toBeInTheDocument()
})

test('이름·학번이 없는 양식은 거부하고 기존 양식 유지', async () => {
  const user = userEvent.setup()
  const db = fresh()
  const { fs } = renderWith(db)
  fs.nextFileToRead = { name: '깨진.hwpx', bytes: await form('표시 없음') }
  await user.click(await screen.findByRole('button', { name: '새 양식 올리기' }))
  expect(await screen.findByText('양식에 {{이름}} 또는 {{학번}} 표시가 없습니다.')).toBeInTheDocument()
  expect(screen.getByText('현재 양식: 기본 양식')).toBeInTheDocument()
})

test('기본 양식으로 되돌리기와 내려받기', async () => {
  const user = userEvent.setup()
  const db = fresh()
  const { fs } = renderWith(db)
  fs.nextFileToRead = { name: 'A.hwpx', bytes: await form('{{학번}}') }
  await user.click(await screen.findByRole('button', { name: '새 양식 올리기' }))
  await screen.findByText('현재 양식: A v1')
  await user.click(screen.getByRole('button', { name: '기본 양식으로 되돌리기' }))
  expect(await screen.findByText('현재 양식: 기본 양식')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '기본 양식 내려받기' }))
  await user.click(screen.getByRole('button', { name: '자리표시자 안내 내려받기' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['결석신고서_기본양식.hwpx', '자리표시자_안내.hwpx']))
})

test('자리표시자 표를 펼쳐 볼 수 있다', async () => {
  const user = userEvent.setup()
  renderWith(fresh())
  await user.click(await screen.findByText('쓸 수 있는 자리표시자 보기'))
  expect(within(screen.getByRole('table', { name: '자리표시자 목록' })).getByText('{{이름}}')).toBeInTheDocument()
})

test('다른 학교 양식(표시 없음, 표 있음): 자리를 찾아 보여 주고, 바꾸고, 미리보기·저장', async () => {
  const user = userEvent.setup()
  const db = fresh()
  const { fs } = renderWith(db)
  const { buildTableHwpx } = await import('../../lib/docs/table-doc')
  fs.nextFileToRead = { name: '옆학교.hwpx', bytes: await buildTableHwpx({ title: '결석계', header: ['성 명', '', '기 간', ''], rows: [['사 유', '', '작성일', '']] }) }
  await user.click(await screen.findByRole('button', { name: '새 양식 올리기' }))
  const t = await screen.findByRole('table', { name: '찾은 자리' })
  expect(within(t).getByRole('combobox', { name: '학생 이름 자리' })).toHaveDisplayValue(/1행 2열/)
  expect(within(t).getByRole('combobox', { name: '사유 자리' })).toHaveDisplayValue(/1행 2열|2행 2열/)
  await user.selectOptions(within(t).getByRole('combobox', { name: '일수 자리' }), '(없음)')
  await user.click(screen.getByRole('button', { name: '가상 학생으로 미리보기' }))
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['옆학교_미리보기.hwpx']))
  const JSZip = (await import('jszip')).default
  const sec = await (await JSZip.loadAsync(fs.downloads[0].bytes)).file('Contents/section0.xml')!.async('string')
  expect(sec).toContain('가상학생')
  expect(sec).not.toContain('{{')
  await user.click(screen.getByRole('button', { name: '이 양식으로 저장' }))
  expect(await screen.findByText('현재 양식: 옆학교 v1')).toBeInTheDocument()
  expect(screen.queryByRole('table', { name: '찾은 자리' })).toBeNull()
})
