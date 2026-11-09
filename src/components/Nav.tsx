import { NavLink } from 'react-router-dom'
import Icon from './Icon'

export const MENU = [
  { to: '/', label: '홈', icon: 'home' },
  { to: '/calendar', label: '달력', icon: 'calendar' },
  { to: '/attendance', label: '출결', icon: 'check' },
  { to: '/counseling', label: '상담일지', icon: 'note' },
  { to: '/class', label: '학급', icon: 'users' },
  { to: '/reports', label: '결석신고서', icon: 'file' },
  { to: '/stats', label: '통계', icon: 'chart' },
  { to: '/settings', label: '설정', icon: 'gear' },
] as const

export default function Nav() {
  return (
    <nav className="nav">
      {MENU.map((m) => (
        <NavLink key={m.to} to={m.to} end={m.to === '/'}>
          <Icon name={m.icon} />
          <span>{m.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
