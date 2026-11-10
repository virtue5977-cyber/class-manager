import { createDb } from '../db/schema'
import { createWebFsAdapter } from './web'

function mkFile(n: number, name: string) {
  const f = new File([new Uint8Array(n)], name)
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new Uint8Array(n).buffer, configurable: true })
  return f
}

function pickWith(file: File) {
  const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { value: [file] })
    this.onchange?.(new Event('change'))
  })
  return spy
}

test('파일 고르기: 종류 제한 없이 고를 수 있고, 너무 크면 읽지 않고 알린다', async () => {
  const fs = createWebFsAdapter(createDb('test-' + crypto.randomUUID()))
  const small = mkFile(3, '공문.hwpx')
  let spy = pickWith(small)
  let accept = ''
  spy.mockImplementationOnce(function (this: HTMLInputElement) {
    accept = this.accept
    Object.defineProperty(this, 'files', { value: [small] })
    this.onchange?.(new Event('change'))
  })
  const a = await fs.pickFileToRead('', { maxBytes: 10 })
  expect(accept).toBe('')
  expect(a).toMatchObject({ name: '공문.hwpx' })
  expect(a!.bytes.length).toBe(3)
  spy.mockRestore()
  const big = mkFile(11, 'big.bin')
  const read = vi.spyOn(big, 'arrayBuffer')
  spy = pickWith(big)
  const b = await fs.pickFileToRead('', { maxBytes: 10 })
  expect(b).toMatchObject({ name: 'big.bin', tooBig: true })
  expect(b!.bytes.length).toBe(0)
  expect(read).not.toHaveBeenCalled()
  spy.mockRestore()
})
