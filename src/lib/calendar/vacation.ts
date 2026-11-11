/** 방학 D-day: 학사일정에서 오늘(포함) 뒤 가장 가까운, 제목에 '방학'이 든 일정 */
export function vacationDday(cal: { date: string; title: string }[], today: string): { title: string; days: number; label: string } | null {
  const next = cal.filter((c) => c.date >= today && c.title.includes('방학')).sort((a, b) => a.date.localeCompare(b.date))[0]
  if (!next) return null
  const days = Math.round((Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)
  return { title: next.title, days, label: days === 0 ? '방학 D-day' : `방학 D-${days}` }
}
