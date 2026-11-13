import { render, screen, waitFor, within } from '@testing-library/react'
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

test('지출 한도 안내는 API 키를 고를 때만, 순서는 연결 방식 → AI 정리 사용', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <AiSettings />
    </AppProviders>,
  )
  const radio = await screen.findByRole('radio', { name: 'Claude Code(Pro 구독)' })
  await user.click(radio)
  await waitFor(() => expect(screen.queryByText(/지출 한도/)).not.toBeInTheDocument())
  expect(radio.compareDocumentPosition(screen.getByLabelText('AI 정리 사용')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: 'Claude API 키' }))
  expect(await screen.findByText(/지출 한도/)).toBeInTheDocument()
})

test('Antigravity(구글 로그인)를 고르면 학습 끄기 안내가 보이고 이름 가림은 늘 켜짐(못 끔)', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()}>
      <AiSettings />
    </AppProviders>,
  )
  await user.click(await screen.findByRole('radio', { name: '구글 Antigravity(로그인)' }))
  expect(await screen.findByText(/Enable Telemetry/)).toBeInTheDocument()
  const mask = screen.getByLabelText(/학생 이름 가리기/)
  expect(mask).toBeChecked()
  expect(mask).toBeDisabled()
})

test('Antigravity 연결 확인: 설치는 됐지만 로그인이 안 됐으면 "연결됨" 대신 로그인 안내', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const g = globalThis as { desktop?: unknown }
  g.desktop = { agy: { status: async () => ({ installed: true, version: '1.2.0', loggedIn: false, message: 'Antigravity 로그인이 필요합니다. 명령 창에서 agy 를 한 번 실행해 구글 계정으로 로그인하세요.' }), ask: async () => '' } }
  try {
    render(
      <AppProviders db={db} fs={createMemoryFsAdapter()}>
        <AiSettings />
      </AppProviders>,
    )
    await user.click(await screen.findByRole('radio', { name: '구글 Antigravity(로그인)' }))
    await user.click(await screen.findByRole('button', { name: 'Antigravity 연결 확인' }))
    const st = await screen.findByRole('status')
    await waitFor(() => expect(st).toHaveTextContent('로그인이 필요합니다'))
    expect(st).not.toHaveTextContent('연결됨')
  } finally {
    delete g.desktop
  }
})

test('구글 Gemini API 키: 연결 방식으로 고르면 키·모델 칸이 나오고, 이름 가리기는 끌 수 없다', async () => {
  const { render, screen } = await import('@testing-library/react')
  const { default: userEvent } = await import('@testing-library/user-event')
  const { MemoryRouter } = await import('react-router-dom')
  const { AppProviders } = await import('../../app/context')
  const { createDb } = await import('../../lib/db/schema')
  const { createMemoryFsAdapter } = await import('../../lib/fs/memory')
  const { default: AiSettings } = await import('./AiSettings')
  const { getSettings, getGeminiKey } = await import('../../lib/settings')
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  render(<MemoryRouter><AppProviders db={db} fs={createMemoryFsAdapter()}><AiSettings /></AppProviders></MemoryRouter>)
  await user.click(await screen.findByRole('radio', { name: '구글 Gemini API 키' }))
  expect((await getSettings(db)).ai_provider).toBe('gemini')
  await user.type(await screen.findByPlaceholderText('AIza...'), 'AIza-test')
  await user.click(screen.getAllByRole('button', { name: '키 저장' })[0])
  expect(await getGeminiKey(db)).toBe('AIza-test')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Gemini 모델' }), 'gemini-3.5-flash-lite')
  expect((await getSettings(db)).gemini_model).toBe('gemini-3.5-flash-lite')
  expect(screen.getByRole('checkbox', { name: /학생 이름 가리기/ })).toBeDisabled()
})

test('설정 > AI 지시문 고치기에 반성문 16줄 지시문도 있고, 샘플 시험은 16줄로', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const lines = Array.from({ length: 16 }, (_, k) => `문장 ${k + 1}`)
  render(
    <AppProviders db={db} fs={createMemoryFsAdapter()} ai={async () => JSON.stringify({ lines })}>
      <AiSettings />
    </AppProviders>,
  )
  await user.click(await screen.findByLabelText('AI 정리 사용'))
  await user.click(screen.getByText('반성문 16줄 지시문'))
  const box = screen.getByLabelText('반성문 16줄 지시문')
  await waitFor(() => expect(box).toHaveValue(DEFAULT_PROMPTS.reflection))
  await user.clear(box)
  await user.type(box, '정중하게 쓴다')
  const det = box.closest('details')!
  await user.click(within(det).getByRole('button', { name: '지시문 저장' }))
  await waitFor(async () => expect(await getPrompt(db, 'reflection')).toBe('정중하게 쓴다'))
  await user.click(within(det).getByRole('button', { name: '샘플로 시험(AI 호출)' }))
  expect(await within(det).findByText(/1\. 문장 1/)).toBeInTheDocument()
})
