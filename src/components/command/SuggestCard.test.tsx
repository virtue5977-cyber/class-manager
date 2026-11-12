import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AppProviders } from '../../app/context'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import SuggestCard from './SuggestCard'

test('추천 카드: 칸에서 고쳐 넣기, 모두 넣기, 넣은 줄은 넣음', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <SuggestCard today="2026-11-12" items={[{ kind: 'notice', text: '강당 교육', date: '2026-11-12' }, { kind: 'event', text: '올림픽', date: '2026-11-13', time: '09:00' }, { kind: 'todo', text: '명단 입력', date: '' }]} />
      </AppProviders>
    </MemoryRouter>,
  )
  const t = screen.getByRole('textbox', { name: '전달사항 1 내용' })
  await user.clear(t)
  await user.type(t, '강당 교육(3교시)')
  await user.click(screen.getAllByRole('button', { name: '넣기' })[0])
  await waitFor(async () => expect((await db.notice_items.toArray()).map((n) => n.text)).toEqual(['강당 교육(3교시)']))
  expect(screen.getByRole('button', { name: '넣음' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '모두 넣기(2)' }))
  await waitFor(async () => expect((await db.todos.toArray()).map((x) => x.parts)).toEqual([['명단 입력']]))
  expect((await db.local_events.toArray()).map((e) => [e.date, e.time, e.title])).toEqual([['2026-11-13', '09:00', '올림픽']])
})

test('리뷰 고침: 넣는 중에는 다시 못 누르고(두 번 넣지 않음), 다시 그려도 넣음 표시가 남고, 5초 안에 되돌린다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const ui = () => (
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <SuggestCard cardKey="c1" today="2026-11-12" items={[{ kind: 'todo', text: '명단 입력', date: '' }, { kind: 'todo', text: '팀 나누기', date: '' }]} />
      </AppProviders>
    </MemoryRouter>
  )
  const { unmount } = render(ui())
  const btn = screen.getAllByRole('button', { name: '넣기' })[0]
  await user.dblClick(btn)
  await waitFor(async () => expect((await db.todos.toArray()).filter((t) => !t.deleted)).toHaveLength(1))
  unmount()
  render(ui())
  expect(screen.getByRole('button', { name: '넣음' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '되돌리기' }))
  await waitFor(async () => expect((await db.todos.toArray()).filter((t) => !t.deleted)).toHaveLength(0))
  expect(screen.getAllByRole('button', { name: '넣기' })).toHaveLength(2)
})

test('일정 추천 카드: 장소·구분을 고쳐 넣으면 그대로 저장', async () => {
  const user = userEvent.setup()
  const db = createDb('t-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <SuggestCard today="2026-11-12" cardKey="pl" items={[{ kind: 'event', text: '도우미 교육', date: '2026-11-13', time: '08:00', place: '시청각실', tag: '업무' }]} />
      </AppProviders>
    </MemoryRouter>,
  )
  const place = await screen.findByLabelText('일정 1 장소')
  expect(place).toHaveValue('시청각실')
  await user.clear(place)
  await user.type(place, '본관 시청각실')
  await user.selectOptions(screen.getByLabelText('일정 1 구분'), '개인')
  await user.click(screen.getByRole('button', { name: '넣기' }))
  await waitFor(async () => expect((await db.local_events.toArray()).map((e) => [e.title, e.place, e.tag])).toEqual([['도우미 교육', '본관 시청각실', '개인']]))
})
