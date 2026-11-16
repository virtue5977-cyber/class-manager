/** 병합 규칙: updated_at이 큰 쪽이 이긴다(같으면 a). 동기화 합치기(Plan B)도 이 함수를 쓴다. */
export function newerWins<T extends { updated_at: string }>(a: T, b: T): T {
  return b.updated_at > a.updated_at ? b : a
}
