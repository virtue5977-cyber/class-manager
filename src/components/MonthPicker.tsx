/** 'YYYY-MM' 고르기. 브라우저 기본 월 입력은 언어 설정에 따라 영어로 보여서 직접 만든다.
 * 날짜·달 이동은 모든 화면에서 같은 모양: [‹] 2026년 11월 [›] [오늘] */
export function shiftMonth(month: string, d: number) {
  const [y, m] = month.split('-').map(Number)
  const t = new Date(y, m - 1 + d, 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
}

const thisMonth = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthPicker({ value, onChange, label = '월', onToday, current = thisMonth() }: { value: string; onChange: (m: string) => void; label?: string; onToday?: () => void; current?: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="step-btn" aria-label="이전 달" title="이전 달" onClick={() => onChange(shiftMonth(value, -1))}>
        ‹
      </button>
      <strong aria-live="polite">{`${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월`}</strong>
      <button type="button" className="step-btn" aria-label="다음 달" title="다음 달" onClick={() => onChange(shiftMonth(value, 1))}>
        ›
      </button>
      <button type="button" className="ghost" disabled={value === current && !onToday} onClick={() => (onToday ? onToday() : onChange(current))}>
        오늘
      </button>
    </div>
  )
}
