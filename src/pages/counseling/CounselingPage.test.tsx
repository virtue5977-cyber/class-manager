import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { createClass, emptyStudent, saveStudent } from '../../lib/roster/roster'
import { updateSettings } from '../../lib/settings'
import { listLogsByStudent } from '../../lib/counseling/counseling'
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
  await user.click(screen.getByRole('button', { name: 'hwpx로 내보내기' }))
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
  expect(await screen.findByText('설정 > AI에서 AI 정리를 켜고 키를 입력하세요.')).toBeInTheDocument()
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
