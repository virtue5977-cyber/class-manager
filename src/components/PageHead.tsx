import type { ReactNode } from 'react'

/** 화면 머리: 제목, 그 아래 한 줄 요약, 오른쪽 도구(학급·날짜·내보내기 등). */
export default function PageHead({ title, summary, children }: { title: ReactNode; summary?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h2>{title}</h2>
        {typeof summary === 'string' ? <span className="muted">{summary}</span> : summary}
      </div>
      {children && <div className="tools">{children}</div>}
    </div>
  )
}
