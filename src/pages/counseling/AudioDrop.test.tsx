import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { SttBridge, SttProgress } from '../../lib/stt/stt'
import AudioDrop from './AudioDrop'
import SttSettings from '../settings/SttSettings'
import { createDb } from '../../lib/db/schema'
import { createMemoryFsAdapter } from '../../lib/fs/memory'
import { AppProviders } from '../../app/context'

function fake(models: ('fast' | 'accurate')[] = ['fast'], text = '안녕하세요') {
  let listener: ((p: SttProgress) => void) | null = null
  let finish: ((v: { text: string }) => void) | null = null
  let fail: ((e: Error) => void) | null = null
  const b = {
    status: vi.fn(async () => ({ supported: true, bin: models.length > 0, models })),
    install: vi.fn(async (m: 'fast' | 'accurate') => (listener?.({ phase: 'model', received: 5, total: 10 }), { supported: true, bin: true, models: [m] })),
    remove: vi.fn(async () => ({ supported: true, bin: false, models: [] })),
    run: vi.fn(() => new Promise<{ text: string }>((res, rej) => { finish = res; fail = rej; listener?.({ phase: 'run', percent: 40 }) })),
    cancel: vi.fn(async () => fail?.(new Error('그만두었습니다.'))),
    onProgress: (cb: (p: SttProgress) => void) => ((listener = cb), () => (listener = null)),
    pathOf: (f: File) => `C:\\녹음\\${f.name}`,
  }
  ;(window as { desktop?: unknown }).desktop = { stt: b }
  return { b: b as unknown as SttBridge & typeof b, done: () => finish?.({ text }) }
}
afterEach(() => delete (window as { desktop?: unknown }).desktop)

function Host({ initial = '메모' }: { initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <AudioDrop onText={(t) => setV((cur) => cur + '|' + t)} />
      <output aria-label="내용">{v}</output>
    </>
  )
}

test('받아쓰기를 받지 않았거나 설치형이 아니면 녹음 칸이 없다', async () => {
  render(<Host />)
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('region', { name: '녹음 파일' })).toBeNull()
  fake([])
  render(<Host />)
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('region', { name: '녹음 파일' })).toBeNull()
})

test('녹음 파일을 끌어 놓으면 이 컴퓨터에서 글로 바꿔 내용에 붙인다', async () => {
  const { b, done } = fake(['fast', 'accurate'])
  render(<Host />)
  const zone = await screen.findByRole('region', { name: '녹음 파일' })
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.mp3')] } })
  expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
  expect(b.run).toHaveBeenCalledWith({ path: 'C:\\녹음\\a.mp3', model: 'accurate' })
  done()
  await waitFor(() => expect(screen.getByLabelText('내용')).toHaveTextContent('메모|안녕하세요'))
})

test('받아쓰는 중 취소하면 내용은 그대로', async () => {
  const user = userEvent.setup()
  const { b } = fake()
  render(<Host />)
  const zone = await screen.findByRole('region', { name: '녹음 파일' })
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'b.wav')] } })
  await user.click(await screen.findByRole('button', { name: '취소' }))
  expect(b.cancel).toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  expect(screen.getByLabelText('내용')).toHaveTextContent(/^메모$/)
})

test('설정: 모델 골라 받기(진행 막대), 받은 뒤 지우기. 설치형이 아니면 안내', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const wrap = (el: JSX.Element) => <AppProviders db={db} fs={createMemoryFsAdapter()}>{el}</AppProviders>
  const r = render(wrap(<SttSettings />))
  expect(await screen.findByText('새 설치형(Windows 앱)이 필요합니다.')).toBeInTheDocument()
  r.unmount()
  const { b } = fake([])
  render(wrap(<SttSettings />))
  await user.click(await screen.findByRole('radio', { name: /정확/ }))
  await user.click(screen.getByRole('button', { name: '받기' }))
  expect(b.install).toHaveBeenCalledWith('accurate')
  expect(await screen.findByText(/받아 둠: 정확/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '지우기' }))
  expect(b.remove).toHaveBeenCalled()
})

test('취소를 눌렀는데 받아쓰기가 끝나 버려도(취소가 늦게 닿음) 내용에 붙이지 않는다', async () => {
  const user = userEvent.setup()
  const { b, done } = fake()
  b.cancel.mockImplementation(async () => {}) // 주 프로세스가 아직 시작 전이라 취소를 못 받음
  render(<Host />)
  const zone = await screen.findByRole('region', { name: '녹음 파일' })
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'c.mp3')] } })
  await user.click(await screen.findByRole('button', { name: '취소' }))
  done()
  await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull())
  expect(screen.getByLabelText('내용')).toHaveTextContent(/^메모$/)
})

test('설정: 받는 중 취소 단추, 프로그램이 빠져 있으면 다시 받기·지우기가 된다', async () => {
  const user = userEvent.setup()
  const db = createDb('test-' + crypto.randomUUID())
  const { b } = fake([])
  b.status.mockResolvedValue({ supported: true, bin: false, models: ['fast'] })
  let stop: (() => void) | null = null
  b.install.mockImplementation(() => new Promise((_res, rej) => { stop = () => rej(new Error('그만두었습니다.')) }))
  b.cancel.mockImplementation(async () => stop?.())
  render(<AppProviders db={db} fs={createMemoryFsAdapter()}><SttSettings /></AppProviders>)
  expect(await screen.findByRole('button', { name: '지우기' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '받기' }))
  await user.click(await screen.findByRole('button', { name: '받기 취소' }))
  expect(b.cancel).toHaveBeenCalled()
  expect(await screen.findByRole('button', { name: '받기' })).toBeEnabled()
})
