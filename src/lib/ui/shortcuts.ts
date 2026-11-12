import { useEffect } from 'react'

export type ShortcutAction =
  | { kind: 'nav'; to: string }
  | { kind: 'step'; dir: 1 | -1 }
  | { kind: 'export' }
  | { kind: 'hideNames' }
  | { kind: 'command' }
  | { kind: 'close' }

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'>

/** 기본 메뉴 순서(설정 > 화면에서 바꾸면 그 순서를 넘겨받는다) */
const NAV = ['/', '/calendar', '/class/roster', '/attendance', '/counseling', '/notes']

/** 키 하나를 앱 동작으로. 글자 칸 안(inField)에서는 Ctrl/Alt 조합과 Esc만 듣는다. 한글 자판이어도 code(키 위치)로 알아듣는다. */
/** nav: 보이는 메뉴 순서(Ctrl+1~9가 이 순서를 따른다). Ctrl+쉼표는 설정. */
export function matchShortcut(e: KeyLike, inField: boolean, nav: string[] = NAV): ShortcutAction | null {
  if (e.isComposing) return null
  const mod = e.ctrlKey || e.metaKey
  const letter = (c: string) => e.code === `Key${c}` || e.key.toLowerCase() === c.toLowerCase()
  if (e.key === 'Escape') return { kind: 'close' }
  if (mod && !e.altKey) {
    const n = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : undefined)
    if (n && !e.shiftKey) return nav[Number(n) - 1] ? { kind: 'nav', to: nav[Number(n) - 1] } : null
    if (!e.shiftKey && (e.code === 'Comma' || e.key === ',')) return { kind: 'nav', to: '/settings' }
    if (e.shiftKey && letter('H')) return { kind: 'hideNames' }
    if (!e.shiftKey && letter('K')) return { kind: 'command' }
    if (!e.shiftKey && letter('E')) return { kind: 'export' }
    return null
  }
  if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return { kind: 'step', dir: e.key === 'ArrowRight' ? 1 : -1 }
  void inField
  return null
}

export const SHORTCUT_TABLE: { keys: string; label: string }[] = [
  { keys: 'Ctrl+K', label: '명령 입력 열기' },
  { keys: 'Ctrl+1 ~ Ctrl+9', label: '왼쪽 메뉴 순서대로 이동(메뉴 순서를 바꾸면 따라 바뀜) · Ctrl+쉼표: 설정' },
  { keys: 'Alt+← / Alt+→', label: '앞 · 뒤(출결 날짜, 달력·신고서·통계 달)' },
  { keys: 'Ctrl+E', label: '지금 화면 내보내기' },
  { keys: 'Ctrl+P', label: '인쇄' },
  { keys: 'Ctrl+Shift+H', label: '학생 이름 가리기 켜기/끄기' },
  { keys: 'Esc', label: '떠 있는 창 · 메뉴 닫기' },
  { keys: '노트 안: Ctrl+1 / 2 / 3', label: '문단 · 제목 1 · 제목 2(노트 글 안에서는 메뉴 이동 대신)' },
  { keys: '노트 안: Ctrl+4 / 5 / 6', label: '글머리 목록 · 번호 목록 · 체크 목록' },
  { keys: '노트 안: Ctrl+Enter', label: '체크 목록 줄 체크 켜기·끄기' },
  { keys: '노트 안: Ctrl+B / U / I', label: '굵게 · 밑줄 · 기울임(글자를 고른 뒤)' },
  { keys: '노트 안: Ctrl+Alt+T', label: '학생 체크 표' },
  { keys: '노트 안: # · ## · - · 1. · [] + 띄어쓰기', label: '줄 맨 앞에 치면 제목·글머리·번호·체크로' },
  { keys: '노트·전달사항: ↑ ↓ ← →', label: '첫·마지막 줄(맨 앞·끝)에서 옆 줄로' },
]

const EVENT = 'watson:shortcut'
export const dispatchShortcut = (a: ShortcutAction) => window.dispatchEvent(new CustomEvent<ShortcutAction>(EVENT, { detail: a }))

/** 화면별 단축키 동작 등록(화면이 사라지면 해제). */
export function useShortcut(kind: ShortcutAction['kind'], fn: (a: ShortcutAction) => void) {
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<ShortcutAction>).detail
      if (a.kind === kind) fn(a)
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [kind, fn])
}
