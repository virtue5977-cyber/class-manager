import { NavLink } from 'react-router-dom'

export const MENU = [
  { to: '/', label: '홈' },
  { to: '/calendar', label: '달력' },
  { to: '/attendance', label: '출결' },
  { to: '/counseling', label: '상담일지' },
  { to: '/class', label: '학급' },
  { to: '/reports', label: '결석신고서' },
  { to: '/stats', label: '통계' },
  { to: '/settings', label: '설정' },
] as const

export default function Nav() {
  return (
    <nav className="nav">
      {MENU.map((m) => (
        <NavLink key={m.to} to={m.to} end={m.to === '/'}>
          {m.label}
        </NavLink>
      ))}
    </nav>
  )
}
