import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { appendChat } from '../../lib/command/chatLog'
import ChatLog from './ChatLog'
import { remember } from './session'

test('기록이 먼저 그려지고 결과가 나중에 와도 되돌리기·카드가 보인다', async () => {
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <ChatLog today="2026-11-10" onRun={() => {}} />
      </AppProviders>
    </MemoryRouter>,
  )
  const chat = await appendChat(db, { input: '/정보 @3', mode: 'rule', summary: '3번 박도윤 정보', links: [], status: '성공' }, new Date('2026-11-10T01:00:00Z'))
  expect(await screen.findByText('3번 박도윤 정보')).toBeInTheDocument()
  act(() => remember(chat.id, { summary: 's', links: [], undo: async () => {}, card: { kind: 'search', data: [{ label: '찾은 것', detail: '', to: '/' }] } }))
  expect(await screen.findByRole('button', { name: /되돌리기 \d+초/ })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '찾은 것' })).toBeInTheDocument()
})
