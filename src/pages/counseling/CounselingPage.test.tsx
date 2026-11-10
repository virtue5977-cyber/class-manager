import { render, screen, waitFor, within } from '@testing-library/react'
import { pickExport } from '../../test/exportMenu'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { updateSettings } from '../../lib/settings'
import { listLogsByStudent, saveLog } from '../../lib/counseling/counseling'
import type { AiRequest } from '../../lib/ai/client'
import CounselingPage from './CounselingPage'

test('기록 추가 → AI 정리(가짜) → 나이스 입력 완료, 미입력 필터, 내보내기', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  await saveStudent(db, c.id, emptyStudent(2, '박민수'))
  await updateSettings(db, { ai_enabled: true })
  const ai = async (req: AiRequest) => {
    const items = JSON.parse(req.user) as { id: string; 메모: string }[]
    return JSON.stringify({ items: items.map((i) => ({ id: i.id, text: `정리: ${i.메모}` })) })
  }
  const fs = createMemoryFsAdapter()
  render(
    <AppProviders db={db} fs={fs} ai={ai}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('장소'), '교실')
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '박민수랑 말다툼')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  const card = await screen.findByRole('article', { name: '2026.11.05.(목) | 교실 기록' })
  expect(within(card).getByText('미정리')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '미정리 1건 누가기록으로 정리' }))
  expect(await screen.findByText('1건을 누가기록으로 정리했습니다.')).toBeInTheDocument()
  const [log] = await listLogsByStudent(db, s.id)
  expect(log.nuga_text).toBe('정리: 박민수랑 말다툼')
  await user.click(within(await screen.findByRole('article')).getByLabelText('나이스 입력 완료'))
  await waitFor(async () => expect((await listLogsByStudent(db, s.id))[0].nuga_status).toBe('나이스 입력 완료'))
  await user.selectOptions(screen.getByLabelText('보기'), '나이스 미입력')
  expect(await screen.findByText('해당하는 기록이 없습니다.')).toBeInTheDocument()
  await pickExport(user, '한글(hwpx)')
  await waitFor(() => expect(fs.downloads.map((d) => d.name)).toEqual(['1번_김지훈_상담일지.hwpx']))
})

test('AI가 꺼져 있으면 안내', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  await user.click(await screen.findByRole('button', { name: '누가기록으로 정리' }))
  expect(await screen.findByText(/AI가 꺼져 있습니다/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '설정 > AI 열기' })).toHaveAttribute('href', '#/settings?tab=ai')
})

test('대상·방법·분야를 고르면 저장되고 분야로 걸러 본다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const s = await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.click(within(screen.getByRole('radiogroup', { name: '대상' })).getByRole('radio', { name: '보호자' }))
  await user.click(within(screen.getByRole('radiogroup', { name: '방법' })).getByRole('radio', { name: '전화' }))
  await user.click(within(screen.getByRole('radiogroup', { name: '분야' })).getByRole('radio', { name: '진로' }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '진학 상담')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  expect(await screen.findByText('보호자 · 전화 · 진로')).toBeInTheDocument()
  expect((await listLogsByStudent(db, s.id))[0]).toMatchObject({ target: '보호자', method: '전화', topic: '진로' })
  await user.selectOptions(screen.getByLabelText('분야 보기'), '학업')
  expect(await screen.findByText('해당하는 기록이 없습니다.')).toBeInTheDocument()
})

test('정리 전 기록은 누가기록 칸 없이 짧게 보이고, "직접 쓰기"를 누르면 칸이 열린다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  await saveStudent(db, c.id, emptyStudent(1, '김지훈'))
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{}'}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 김지훈/ }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  const card = await screen.findByRole('article')
  expect(within(card).queryByLabelText('누가기록')).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: '복사' })).not.toBeInTheDocument()
  await user.click(within(card).getByRole('button', { name: '직접 쓰기' }))
  expect(within(card).getByLabelText('누가기록')).toBeInTheDocument()
})

test('학생 목록에 마지막 상담일을 보이고, 한 달 넘게 기록이 없으면 표시하며, 오래된 순으로 정렬할 수 있다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  const b = await saveStudent(db, c.id, emptyStudent(2, '다라'))
  await saveLog(db, { student_id: a.id, date: '2026-11-02', place: '', content: '최근' })
  await saveLog(db, { student_id: b.id, date: '2026-09-01', place: '', content: '오래전' })
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  const ga = await screen.findByRole('button', { name: /^1번 가나/ })
  await waitFor(() => expect(ga).toHaveTextContent('11/2'))
  expect(ga).not.toHaveTextContent('한 달 넘음')
  expect(screen.getByRole('button', { name: /^2번 다라/ })).toHaveTextContent('한 달 넘음')
  await user.selectOptions(screen.getByLabelText('정렬'), '오래된 순')
  const names = within(screen.getByRole('list', { name: '학생 목록' })).getAllByRole('button').map((x) => x.textContent)
  expect(names[0]).toMatch(/^2번 다라/)
})

test('새 기록을 저장하면 입력 칸이 닫히고 그 기록이 잠깐 강조된다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const c = await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  const a = await saveStudent(db, c.id, emptyStudent(1, '가나'))
  await saveLog(db, { student_id: a.id, date: '2026-11-01', place: '', content: '예전' })
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <CounselingPage today="2026-11-05" />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('button', { name: /^1번 가나/ }))
  await user.click(await screen.findByRole('button', { name: '+ 새 기록' }))
  await user.type(screen.getByLabelText('내용(개조식 메모나 녹음 글)'), '새 메모')
  await user.click(screen.getByRole('button', { name: '기록 추가' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '기록 추가' })).not.toBeInTheDocument())
  const fresh = (await screen.findAllByRole('article')).find((x) => x.textContent?.includes('새 메모'))!
  expect(fresh).toHaveClass('flash')
})
