import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { updateSettings } from '../../lib/settings'
import { getBriefing } from '../../lib/briefing/briefing'
import { newRecord } from '../../lib/db/records'
import type { SchoolCalendarRec } from '../../lib/db/types'
import HomePage from './HomePage'

test('오늘·일정 D-day, 붙여넣기 AI 정리 → 조례·종례 체크리스트, 직접 추가·완료', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  await updateSettings(db, { ai_enabled: true })
  await db.school_calendar.add(newRecord({ date: '2026-11-12', title: '체육대회', type: '행사', is_class_day: true, source: 'manual' }) as SchoolCalendarRec)
  const ai = async () => JSON.stringify({ 조례: ['3교시 후 강당 집합'], 종례: ['동의서 내일까지 제출'] })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()} ai={ai}>
        <HomePage today="2026-11-05" />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText(/11월 5일\(목\) · 수업일/)).toBeInTheDocument()
  expect(await screen.findByText('D-7')).toBeInTheDocument()
  await user.type(screen.getByLabelText('학교 메신저·공문 글 붙여넣기'), '교무부 안내 …')
  await user.click(screen.getByRole('button', { name: 'AI로 정리' }))
  expect(await screen.findByText('조례 1개, 종례 1개를 정리했습니다. 확인하고 고치세요.')).toBeInTheDocument()
  expect(screen.getByLabelText('1번 내용')).toHaveValue('3교시 후 강당 집합')
  await user.type(screen.getByLabelText('직접 추가'), '우산 챙기기')
  await user.click(screen.getByRole('button', { name: '추가' }))
  await user.click(screen.getByLabelText('1번 전달 완료'))
  await waitFor(async () => expect((await getBriefing(db, '2026-11-05', '조례'))!.items.map((i) => [i.text, i.done])).toEqual([['3교시 후 강당 집합', true], ['우산 챙기기', false]]))
  await user.click(screen.getByRole('tab', { name: /^종례/ }))
  expect(screen.getByLabelText('1번 내용')).toHaveValue('동의서 내일까지 제출')
})

test('처음에는 시작하기 단계가 보이고, 학급을 만들면 체크된다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  const { createClass } = await import('../../lib/roster/roster')
  await createClass(db, { school_year: 2026, grade: 1, class_no: 5 })
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <HomePage today="2026-11-06" />
      </AppProviders>
    </MemoryRouter>,
  )
  expect(await screen.findByText('시작하기 · 남은 단계 4개')).toBeInTheDocument()
  expect(screen.getByText('학급 만들기').closest('li')).toHaveClass('done')
})
