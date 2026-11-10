/** 해시 주소(#/화면?이름=값)의 값. 라우터 밖(테스트 등)에서도 읽을 수 있게 직접 푼다. */
export function hashParam(name: string): string | null {
  const q = window.location.hash.split('?')[1]
  return q ? new URLSearchParams(q).get(name) : null
}
export const ymdParam = (name = 'date') => {
  const v = hashParam(name)
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}
