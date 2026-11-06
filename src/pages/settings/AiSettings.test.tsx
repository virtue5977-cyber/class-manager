import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'
import { getAiKey, getSettings } from '../../lib/settings'
import { getPrompt, DEFAULT_PROMPTS } from '../../lib/ai/prompts'
import AiSettings from './AiSettings'

test('키 저장(기기 전용), 켜기, 지시문 저장·되돌리기, 샘플 시험', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => '{"items":[{"id":"sample","text":"샘플 결과"}]}'}>
      <AiSettings />
    </AppProviders>,
  )
  await user.type(await screen.findByPlaceholderText('sk-ant-...'), 'sk-test')
  await user.click(screen.getByRole('button', { name: '키 저장' }))
  await waitFor(async () => expect(await getAiKey(db)).toBe('sk-test'))
  await user.click(screen.getByLabelText('AI 정리 사용'))
  await waitFor(async () => expect((await getSettings(db)).ai_enabled).toBe(true))
  await user.click(screen.getByText('누가기록 정리 지시문'))
  const box = screen.getByLabelText('누가기록 정리 지시문')
  await user.clear(box)
  await user.type(box, '짧게 쓴다')
  await user.click(screen.getAllByRole('button', { name: '지시문 저장' })[0])
  await waitFor(async () => expect(await getPrompt(db, 'nuga')).toBe('짧게 쓴다'))
  await user.click(screen.getAllByRole('button', { name: '샘플로 시험(AI 호출)' })[0])
  expect(await screen.findByText('샘플 결과')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: '기본값으로 되돌리기' })[0])
  await waitFor(async () => expect(await getPrompt(db, 'nuga')).toBe(DEFAULT_PROMPTS.nuga))
})
