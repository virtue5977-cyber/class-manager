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

test('AI 대답 카드의 "노트로": 입력·대답(초안 글)을 새 노트로', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <MemoryRouter>
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <ChatLog today="2026-11-10" onRun={() => {}} />
      </AppProviders>
    </MemoryRouter>,
  )
  const chat = await appendChat(db, { input: '/전달 학부모 @3 내일 체육복', mode: 'hybrid', summary: '학부모께 보낼 글 초안', links: [], status: '성공' }, new Date('2026-11-10T01:00:00Z'))
  act(() => remember(chat.id, { summary: '학부모께 보낼 글 초안', links: [], card: { kind: 'draft', data: { kind: 'message', text: '내일 체육복을 챙겨 주세요.' } } }))
  await user.click(await screen.findByRole('button', { name: '노트로' }))
  expect(await screen.findByText('노트로 보냈습니다.')).toBeInTheDocument()
  const [n] = await db.notes.toArray()
  expect(n.title).toBe('학부모께 보낼 글 초안')
  expect(n.blocks.map((b) => b.text).join('\n')).toContain('내일 체육복을 챙겨 주세요.')
  expect(n.blocks.map((b) => b.text).join('\n')).toContain('/전달 학부모 @3 내일 체육복')
})
