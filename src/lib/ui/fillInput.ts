/** React가 관리하는 입력칸에 글을 넣고(변경 알림 포함) 끝에 커서를 둔다. */
export function fillInput(el: HTMLInputElement | null | undefined, text: string): void {
  if (!el) return
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  set?.call(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  // 누른 단추가 초점을 가져간 뒤에 입력칸으로 옮긴다
  setTimeout(() => {
    el.focus()
    el.setSelectionRange(text.length, text.length)
  }, 0)
}
