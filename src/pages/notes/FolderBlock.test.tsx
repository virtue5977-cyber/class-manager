import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FolderBlock from './FolderBlock'
import { NOT_ALLOWED } from '../../lib/notes/folders'

const ipcErr = (ch: string, m: string) => new Error(`Error invoking remote method '${ch}': Error: ${m}`)

function bridge(allowed: Set<string>) {
  const b = {
    pick: vi.fn(),
    open: vi.fn(async (p: string) => { if (!allowed.has(p)) throw ipcErr('folder:open', NOT_ALLOWED) }),
    list: vi.fn(async (p: string) => { if (!allowed.has(p)) throw ipcErr('folder:list', NOT_ALLOWED); return [{ name: '공문.hwpx', dir: false }] }),
    allow: vi.fn(async (p: string) => (allowed.add(p), { path: p })),
  }
  ;(window as { desktop?: unknown }).desktop = { folder: b }
  return b
}
afterEach(() => delete (window as { desktop?: unknown }).desktop)

test('저장된 폴더가 아직 허용되지 않았으면 "이 폴더를 열도록 허용" 단추로 다시 골라 연다', async () => {
  const user = userEvent.setup()
  const b = bridge(new Set())
  const onPath = vi.fn()
  const onMsg = vi.fn()
  render(<FolderBlock path={'C:\\학급\\자료'} onPath={onPath} onMsg={onMsg} />)
  expect(screen.queryByRole('button', { name: '이 폴더를 열도록 허용' })).toBeNull()
  await user.click(screen.getByRole('button', { name: /C:\\학급\\자료/ }))
  const allow = await screen.findByRole('button', { name: '이 폴더를 열도록 허용' })
  expect(onMsg).not.toHaveBeenCalledWith(expect.stringContaining('Error invoking'))
  await user.click(allow)
  expect(b.allow).toHaveBeenCalledWith('C:\\학급\\자료')
  await waitFor(() => expect(b.open).toHaveBeenLastCalledWith('C:\\학급\\자료'))
  expect(b.open).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('button', { name: '이 폴더를 열도록 허용' })).toBeNull()
  expect(onPath).not.toHaveBeenCalled()
})

test('허용 대화상자에서 다른 폴더를 고르면 블록 경로를 그 폴더로 바꾼다', async () => {
  const user = userEvent.setup()
  const b = bridge(new Set())
  b.allow.mockImplementation(async () => ({ path: 'D:\\새 자료' }))
  const onPath = vi.fn()
  render(<FolderBlock path={'C:\\옛'} onPath={onPath} onMsg={() => {}} />)
  await user.click(screen.getByRole('button', { name: '안의 파일 보기' }))
  await user.click(await screen.findByRole('button', { name: '이 폴더를 열도록 허용' }))
  expect(onPath).toHaveBeenCalledWith('D:\\새 자료')
})

test('허용된 폴더는 바로 목록을 보여 주고, 다른 오류는 글로 알린다', async () => {
  const user = userEvent.setup()
  const b = bridge(new Set(['C:\\a']))
  const onMsg = vi.fn()
  const { rerender } = render(<FolderBlock path={'C:\\a'} onPath={() => {}} onMsg={onMsg} />)
  await user.click(screen.getByRole('button', { name: '안의 파일 보기' }))
  expect(await screen.findByText(/공문\.hwpx/)).toBeInTheDocument()
  b.open.mockRejectedValueOnce(ipcErr('folder:open', '폴더를 찾지 못했습니다.'))
  rerender(<FolderBlock path={'C:\\a'} onPath={() => {}} onMsg={onMsg} />)
  await user.click(screen.getByRole('button', { name: /C:\\a/ }))
  await waitFor(() => expect(onMsg).toHaveBeenCalledWith('폴더를 찾지 못했습니다.'))
  expect(screen.queryByRole('button', { name: '이 폴더를 열도록 허용' })).toBeNull()
})
