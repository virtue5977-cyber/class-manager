/**
 * 함초롬돋움·궁서 글자 폭(em). 노트북에 글꼴이 없어도 한글 파일과 같은 기준으로 재기 위해 표로 둔다.
 * 한글·한자·전각은 1em(정사각), 그 밖은 보수적으로(조금 넓게) 잡는다.
 */
export function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xff00 && c <= 0xffef)) return 1
  if (ch === ' ') return 0.33
  if (/[WM]/.test(ch)) return 0.95
  if (/[mw]/.test(ch)) return 0.82
  if (/[0-9]/.test(ch)) return 0.55
  if (/[a-z]/.test(ch)) return 0.55
  if (/[A-Z]/.test(ch)) return 0.68
  if (/[.,'’‘:;!|]/.test(ch)) return 0.3
  if (/[()[\]"“”?\-~]/.test(ch)) return 0.42
  return 1
}

export const textEm = (s: string) => [...s].reduce((a, ch) => a + charEm(ch), 0)
