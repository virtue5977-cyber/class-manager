import { dropIndex, reorderIds, startPointerDrag } from './pointerDrag'

test('dropIndex: 줄 가운데 높이들 기준으로 놓일 자리(0~n)', () => {
  const mids = [10, 30, 50]
  expect(dropIndex(mids, 0)).toBe(0)
  expect(dropIndex(mids, 25)).toBe(1)
  expect(dropIndex(mids, 49)).toBe(2)
  expect(dropIndex(mids, 99)).toBe(3)
})

test('reorderIds: 하나를 빼서 놓일 자리에 끼운다(자기 자리 앞뒤는 그대로)', () => {
  expect(reorderIds(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'a', 'd'])
  expect(reorderIds(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
  expect(reorderIds(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c'])
  expect(reorderIds(['a', 'b', 'c'], 'b', 2)).toEqual(['a', 'b', 'c'])
  expect(reorderIds(['a', 'b', 'c'], 'x', 0)).toEqual(['a', 'b', 'c'])
})

test('startPointerDrag: 5px 넘게 움직여야 끌기, 놓으면 onDrop, 그보다 적으면 아무 일도 없고 클릭은 막지 않는다', () => {
  const ev = (type: string, x: number, y: number) => new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
  const log: string[] = []
  startPointerDrag({ clientX: 0, clientY: 0, button: 0 } as PointerEvent, { onStart: () => log.push('start'), onMove: (_x, y) => log.push(`move${y}`), onDrop: (_x, y) => log.push(`drop${y}`) })
  window.dispatchEvent(ev('pointermove', 0, 3))
  expect(log).toEqual([])
  window.dispatchEvent(ev('pointermove', 0, 20))
  window.dispatchEvent(ev('pointerup', 0, 22))
  expect(log).toEqual(['start', 'move20', 'drop22'])
  const log2: string[] = []
  startPointerDrag({ clientX: 0, clientY: 0, button: 0 } as PointerEvent, { onDrop: () => log2.push('drop') })
  window.dispatchEvent(ev('pointermove', 2, 2))
  window.dispatchEvent(ev('pointerup', 2, 2))
  expect(log2).toEqual([])
})

test('Esc는 끌기를 그만둔다(onCancel), 오른쪽 버튼은 무시', () => {
  const log: string[] = []
  startPointerDrag({ clientX: 0, clientY: 0, button: 0 } as PointerEvent, { onMove: () => log.push('m'), onDrop: () => log.push('drop'), onCancel: () => log.push('cancel') })
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 30 }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: 30 }))
  expect(log).toEqual(['m', 'cancel'])
  const log2: string[] = []
  startPointerDrag({ clientX: 0, clientY: 0, button: 2 } as PointerEvent, { onStart: () => log2.push('s') })
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 30 }))
  expect(log2).toEqual([])
})

test('브라우저가 끌기를 가져가면(pointercancel) 취소하고 정리한다: 다음 클릭에 엉뚱한 곳에 놓이지 않는다', () => {
  const log: string[] = []
  startPointerDrag({ clientX: 0, clientY: 0, button: 0 } as PointerEvent, { onMove: () => log.push('m'), onDrop: () => log.push('drop'), onCancel: () => log.push('cancel') })
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: 30 }))
  window.dispatchEvent(new MouseEvent('pointercancel'))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 60 }))
  expect(log).toEqual(['m', 'cancel'])
  expect(document.body.classList.contains('is-dragging')).toBe(false)
})
