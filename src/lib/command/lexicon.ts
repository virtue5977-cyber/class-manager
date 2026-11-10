// 명령에서 알아듣는 낱말(규칙 사전)
export const KINDS = ['결석', '지각', '조퇴', '결과'] as const
export const CATEGORIES: Record<string, string> = { 미인정: '미인정', 질병: '질병', 출석인정: '출석인정', 인정: '출석인정' }
export const CATEGORY_WORDS = ['미인정', '질병', '출석인정']
export const EVENT_TAGS = ['개인', '업무'] as const

/** '3교시' → '3', '5~7교시'·'5-7교시' → '5~7' */
export function parsePeriod(w: string): string | null {
  const m = /^(\d{1,2})(?:[~-](\d{1,2}))?교시$/.exec(w)
  if (!m) return null
  return m[2] ? `${m[1]}~${m[2]}` : m[1]
}
