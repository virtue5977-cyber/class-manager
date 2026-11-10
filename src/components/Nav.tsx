import { NavLink, useLocation } from 'react-router-dom'
import Icon from './Icon'

export interface MenuItem {
  to: string
  base: string // 이 주소로 시작하면 하위 메뉴를 펼친다
  label: string
  icon: string
  children?: { to: string; label: string }[]
}

export const MENU: MenuItem[] = [
  { to: '/', base: '/', label: '홈', icon: 'home' },
  { to: '/calendar', base: '/calendar', label: '달력', icon: 'calendar' },
  { to: '/attendance', base: '/attendance', label: '출결', icon: 'check', children: [{ to: '/attendance/reports', label: '결석신고서' }, { to: '/attendance/stats', label: '통계' }] },
  { to: '/counseling', base: '/counseling', label: '상담일지', icon: 'note' },
  {
    to: '/class/roster', base: '/class', label: '학급', icon: 'users',
    children: [
      { to: '/class/roster', label: '명단' },
      { to: '/class/sheet', label: '명렬표' },
      { to: '/class/seating', label: '자리배치' },
      { to: '/class/cleaning', label: '청소배치' },
      { to: '/class/reflection', label: '반성문' },
    ],
  },
]
export const SETTINGS_ITEM: MenuItem = { to: '/settings', base: '/settings', label: '설정', icon: 'gear' }

function Item({ m, badge }: { m: MenuItem; badge?: number }) {
  const { pathname } = useLocation()
  const open = !!m.children && (pathname === m.base || pathname.startsWith(m.base + '/'))
  return (
    <>
      <NavLink to={m.to} end={m.to === '/' || m.to === '/attendance'} className={({ isActive }) => (isActive || (open && m.base !== '/attendance') ? 'active' : undefined)}>
        <Icon name={m.icon} />
        <span>{m.label}</span>
        {!!badge && <span className="badge" aria-hidden="true">{badge}</span>}
      </NavLink>
      {open && (
        <div className="subnav">
          {m.children!.map((c) => (
            <NavLink key={c.to} to={c.to}>
              {c.label}
            </NavLink>
          ))}
        </div>
      )}
    </>
  )
}

export default function Nav({ badges = {} }: { badges?: Record<string, number> }) {
  return (
    <nav className="nav" aria-label="메뉴">
      {MENU.map((m) => (
        <Item key={m.to} m={m} badge={badges[m.base]} />
      ))}
    </nav>
  )
}

export function SettingsNav() {
  return (
    <nav className="nav" aria-label="설정">
      <Item m={SETTINGS_ITEM} />
    </nav>
  )
}
