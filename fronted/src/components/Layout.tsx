import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/dashboard', label: 'Boshqaruv', icon: '▦' },
  { to: '/students', label: "O'quvchilar", icon: '👥' },
  { to: '/attendance', label: 'Davomat', icon: '✓' },
  { to: '/payments', label: "To'lovlar", icon: '₮' },
  { to: '/debtors', label: 'Qarzdorlar', icon: '!' },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('edulive_theme') ?? 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('edulive_theme', theme);
  }, [theme]);
  return (
    <button
      className="btn btn-ghost sm"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Mavzuni almashtirish"
    >
      {theme === 'dark' ? '☀ Yorug\'' : '🌙 Qorong\'i'}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();

  // O'qituvchi web'da faqat davomatni ko'radi; asosiy ish stoli — admin/menejer uchun
  const nav = user?.role === 'teacher' ? NAV.filter((n) => n.to === '/attendance') : NAV;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">EduLive</div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span aria-hidden>{n.icon}</span> {n.label}
          </NavLink>
        ))}
      </aside>

      <div className="content">
        {!online && (
          <div className="offline-banner" role="status">
            ⚠ Internet aloqasi yo'q — ma'lumotlar eskirgan bo'lishi mumkin
          </div>
        )}
        <header className="topbar">
          <strong style={{ fontSize: 15 }}>{user?.fullName}</strong>
          <span className="muted">
            {user?.role === 'admin' ? 'Administrator'
              : user?.role === 'manager' ? 'Menejer'
              : user?.role === 'teacher' ? "O'qituvchi" : 'Superadmin'}
          </span>
          <div className="spacer" />
          <ThemeToggle />
          <button className="btn btn-ghost sm" onClick={() => { logout(); navigate('/login'); }}>
            Chiqish
          </button>
        </header>
        <main>{children}</main>

        <nav className="mobile-nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span aria-hidden>{n.icon}</span> {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
