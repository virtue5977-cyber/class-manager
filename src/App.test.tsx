import { render, screen, within, waitFor } from '@testing-library/react'
import App from './App'
import { createDb } from './lib/db/schema'
import { createMemoryFsAdapter } from './lib/fs/memory'

const setup = () => render(<App db={createDb('test-' + crypto.randomUUID())} fs={createMemoryFsAdapter()} />)

test('앱 이름 Watson이 보인다', async () => {
  window.location.hash = ''
  setup()
  expect(await screen.findByText('Watson')).toBeInTheDocument()
})

test('메뉴는 홈·달력·학급·출결·누가기록·노트함 순서(사용자 요청 11/11)이고 설정은 맨 아래 따로', async () => {
  window.location.hash = ''
  setup()
  const nav = await screen.findByRole('navigation', { name: '메뉴' })
  expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['홈', '달력', '학급', '출결', '누가기록', '노트함'])
  expect(within(screen.getByRole('navigation', { name: '설정' })).getByRole('link', { name: '설정' })).toBeInTheDocument()
})

test('암호구가 없으면 시작 배너가 보인다', async () => {
  setup()
  expect(await screen.findByText('백업 암호구가 설정되지 않았습니다. 설정에서 백업을 켜 주세요.')).toBeInTheDocument()
})

test('배너에 설정으로 이동 링크가 있다', async () => {
  setup()
  await screen.findByText('백업 암호구가 설정되지 않았습니다. 설정에서 백업을 켜 주세요.')
  expect(screen.getByRole('link', { name: '설정으로 이동' })).toHaveAttribute('href', '#/settings?tab=backup')
})

test('설정에서 암호구를 저장하면 배너가 바로 사라진다', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  const { createMemoryFolder } = await import('./lib/fs/memory')
  const user = userEvent.setup()
  window.location.hash = '#/settings'
  render(<App db={createDb('test-' + crypto.randomUUID())} fs={createMemoryFsAdapter(createMemoryFolder())} backupIterations={1000} />)
  const bannerText = '백업 암호구가 설정되지 않았습니다. 설정에서 백업을 켜 주세요.'
  await screen.findByText(bannerText)
  await user.type(screen.getByLabelText('새 암호구'), '우리반암호구2026')
  await user.type(screen.getByLabelText('암호구 확인'), '우리반암호구2026')
  await user.click(screen.getByRole('button', { name: '암호구 저장' }))
  await screen.findByText('암호구를 저장했습니다.')
  await waitFor(() => expect(screen.queryByText(bannerText)).not.toBeInTheDocument())
  window.location.hash = ''
})

describe('옛 exe 지킴이', () => {
  afterEach(() => { delete (window as { desktop?: unknown }).desktop })

  test('SHELL 6 exe에서 watson- DB가 있으면 안내만 보이고 홈은 없다', async () => {
    ;(window as { desktop?: unknown }).desktop = { shell: 6, isDesktop: true }
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open('watson-x')
      r.onsuccess = () => { r.result.close(); res() }
      r.onerror = () => rej(r.error)
    })
    render(<App fs={createMemoryFsAdapter()} />)
    expect(await screen.findByText(/이 exe는 오래됐습니다/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '홈' })).not.toBeInTheDocument()
    indexedDB.deleteDatabase('watson-x')
  })
})
