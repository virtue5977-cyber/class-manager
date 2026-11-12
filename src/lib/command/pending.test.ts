import { addPending, enqueue, pendingList, removePending } from './pending'

test('enqueue는 차례로, 실패해도 다음 것을 돈다', async () => {
  const order: string[] = []
  const slow = enqueue(async () => {
    await new Promise((r) => setTimeout(r, 20))
    order.push('a')
    throw new Error('x')
  })
  const fast = enqueue(async () => {
    order.push('b')
    return 2
  })
  await expect(slow).rejects.toThrow('x')
  expect(await fast).toBe(2)
  expect(order).toEqual(['a', 'b'])
})

test('pending 넣고 빼기', () => {
  const id = addPending({ input: '안녕', thread: 't' })
  expect(pendingList().map((p) => p.input)).toEqual(['안녕'])
  removePending(id)
  expect(pendingList()).toEqual([])
})
