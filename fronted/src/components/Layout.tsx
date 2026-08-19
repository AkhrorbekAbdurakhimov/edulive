import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, roleLabel } from '../lib/auth';
import { useSchool } from '../lib/school';
import { api } from '../lib/api';

const NAV = [
  { to: '/dashboard', label: 'Boshqaruv', icon: '▦' },
  { to: '/students', label: "O'quvchilar", icon: '👥' },
  { to: '/attendance', label: 'Davomat', icon: '✓' },
  { to: '/payments', label: "To'lovlar", icon: '₮' },
  { to: '/debtors', label: 'Qarzdorlar', icon: '!' },
];
const SCHOOLS_NAV = { to: '/schools', label: 'Maktablar', icon: '🏫' };

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
      <span aria-hidden>{theme === 'dark' ? '☀' : '🌙'}</span>
      <span className="label">{theme === 'dark' ? 'Yorug\'' : 'Qorong\'i'}</span>
    </button>
  );
}

/**
 * Superadmin qaysi maktab ichida ekanini doim ko'rib tursin — aks holda
 * boshqa maktabning ma'lumotini o'zinikidek o'qib qolish oson.
 */
function ActiveSchool() {
  const { schoolId, leave } = useSchool();
  const navigate = useNavigate();

  const schools = useQuery({
    queryKey: ['schools'],
    queryFn: async () => (await api.get<{ items: Array<{ id: string; name: string }> }>('/schools')).data.items,
  });
  const name = schools.data?.find((s) => s.id === schoolId)?.name;

  return (
    <span className="chip neutral" style={{ gap: 8 }}>
      <span aria-hidden>🏫</span>
      <span className="school-name">{name ?? 'Maktab'}</span>
      <button
        className="btn btn-ghost sm"
        style={{ padding: '0 6px', minHeight: 'auto' }}
        title="Maktabdan chiqib, platforma darajasiga qaytish"
        onClick={() => { leave(); navigate('/schools'); }}
      >
        ✕
      </button>
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { schoolId } = useSchool();
  const navigate = useNavigate();
  const online = useOnline();

  const isSuper = user?.role === 'superadmin';

  // O'qituvchi web'da faqat davomatni ko'radi; asosiy ish stoli — admin/menejer uchun.
  // Superadmin esa maktab tanlamaguncha maktab ichidagi bo'limlarni ko'rmaydi:
  // ular X-School-Id siz baribir "Maktab tanlanmagan" xatosini beradi.
  const nav = user?.role === 'teacher'
    ? NAV.filter((n) => n.to === '/attendance')
    : isSuper
      ? [SCHOOLS_NAV, ...(schoolId ? NAV : [])]
      : NAV;

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
          {/* Ism — sozlamalarga kirish nuqtasi. Alohida menyu bandi qo'shilmadi:
              pastki mobil menyu allaqachon 6 tagacha bandni ko'taryapti. */}
          <NavLink to="/settings" className="user-link" title="Sozlamalar">
            <strong style={{ fontSize: 15 }}>{user?.fullName}</strong>
          </NavLink>
          <span className="muted role">{roleLabel(user?.role)}</span>
          {isSuper && schoolId && <ActiveSchool />}
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
