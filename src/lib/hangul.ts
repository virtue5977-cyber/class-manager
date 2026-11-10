const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'

/** 완성형 한글 음절을 초성으로(그 밖 글자는 그대로). */
export function choseong(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00
    out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch
  }
  return out
}

const isCho = (s: string) => [...s].every((ch) => CHO.includes(ch))

/** 이름 찾기: 글이 이름에 들어 있거나, 초성만 쳤으면 이름 초성의 앞부분과 같을 때. */
export function matchName(q: string, name: string): boolean {
  const t = q.trim()
  if (!t) return true
  return isCho(t) ? choseong(name).startsWith(t) : name.includes(t)
}
