/** 학년도: 3월~12월은 그해, 1~2월은 전년도. */
export function currentSchoolYear(now: Date = new Date()): number {
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear()
}
