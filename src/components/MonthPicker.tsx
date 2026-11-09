/** 'YYYY-MM' 고르기. 브라우저 기본 월 입력은 언어 설정에 따라 영어로 보여서 직접 만든다. */
export function shiftMonth(month: string, d: number) {
  const [y, m] = month.split('-').map(Number)
  const t = new Date(y, m - 1 + d, 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthPicker({ value, onChange, label = '월' }: { value: string; onChange: (m: string) => void; label?: string }) {
  return (
    <div className="month-picker" role="group" aria-label={label}>
      <button type="button" aria-label="이전 달" onClick={() => onChange(shiftMonth(value, -1))}>
        ◀
      </button>
      <strong aria-live="polite">{`${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월`}</strong>
      <button type="button" aria-label="다음 달" onClick={() => onChange(shiftMonth(value, 1))}>
        ▶
      </button>
    </div>
  )
}
