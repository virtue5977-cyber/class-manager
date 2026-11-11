import { installMenuAutoClose } from './autoCloseMenus'

function setup() {
  document.body.innerHTML = `<main id="out">밖</main>
  <details class="chat-menu" id="a"><summary>⋯</summary><div class="menu-list"><button id="item">노트로</button></div></details>
  <details class="menu" id="b"><summary>더보기</summary><button id="item2">x</button></details>
  <details class="panel" id="c"><summary>접는 칸</summary><button id="in-c">x</button></details>`
  return installMenuAutoClose(document)
}
const $ = (id: string) => document.getElementById(id) as HTMLDetailsElement

test('바깥을 누르면 메뉴(details.chat-menu·.menu)는 닫히고, 접는 칸(.panel)은 그대로', () => {
  const off = setup()
  $('a').open = true
  $('b').open = true
  $('c').open = true
  $('out').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  expect($('a').open).toBe(false)
  expect($('b').open).toBe(false)
  expect($('c').open).toBe(true)
  off()
})

test('메뉴 안쪽을 누르면 닫히지 않고, 메뉴 항목을 고르면 닫힌다', () => {
  const off = setup()
  $('a').open = true
  $('item').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  expect($('a').open).toBe(true)
  $('item').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect($('a').open).toBe(false)
  off()
})

test('다른 메뉴를 열면 앞의 메뉴는 닫힌다', () => {
  const off = setup()
  $('a').open = true
  $('b').querySelector('summary')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  expect($('a').open).toBe(false)
  off()
})

test('Esc는 열린 메뉴를 닫고 초점을 그 메뉴의 단추(summary)로', () => {
  const off = setup()
  $('a').open = true
  ;($('item') as HTMLElement).focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect($('a').open).toBe(false)
  expect(document.activeElement).toBe($('a').querySelector('summary'))
  off()
})

test('화면이 바뀌면(hashchange) 모두 닫힌다, 해제하면 더는 닫지 않는다', () => {
  const off = setup()
  $('b').open = true
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect($('b').open).toBe(false)
  off()
  $('b').open = true
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  expect($('b').open).toBe(true)
})
