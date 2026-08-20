import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, roleLabel } from '../lib/auth';
import { useSchool } from '../lib/school';
import { api } from '../lib/api';

interface NavItem { to: string; label: string; icon: string }

const SCHOOL_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Boshqaruv', icon: '▦' },
  { to: '/classes', label: 'Sinflar', icon: '▤' },
  { to: '/students', label: "O'quvchilar", icon: '👥' },
  { to: '/attendance', label: 'Davomat', icon: '✓' },
  { to: '/payments', label: "To'lovlar", icon: '₮' },
  { to: '/debtors', label: 'Qarzdorlar', icon: '!' },
  { to: '/users', label: 'Xodimlar', icon: '🧑' },
];
const SCHOOLS_NAV: NavItem = { to: '/schools', label: 'Maktablar', icon: '🏫' };
const SETTINGS_NAV: NavItem = { to: '/settings', label: 'Sozlamalar', icon: '⚙' };

/** Pastki mobil panelga shuncha band sig'adi; qolgani "Yana" varaqasiga tushadi. */
const MOBILE_SLOTS = 4;

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
    queryFn: async () =>
      (await api.get<{ items: Array<{ id: string; name: string; logo_url: string | null }> }>('/schools')).data.items,
  });
  const school = schools.data?.find((s) => s.id === schoolId);

  return (
    <span className="chip neutral active-school">
      {school?.logo_url
        ? <img className="chip-logo" src={school.logo_url} alt="" />
        : <span aria-hidden>🏫</span>}
      <span className="school-name">{school?.name ?? 'Maktab'}</span>
      <button
        className="chip-x"
        title="Maktabdan chiqib, platforma darajasiga qaytish"
        aria-label="Maktabdan chiqish"
        onClick={() => { leave(); navigate('/schools'); }}
      >
        ✕
      </button>
    </span>
  );
}

function NavItems({ items, onClick }: { items: NavItem[]; onClick?: () => void }) {
  return (
    <>
      {items.map((n) => (
        <NavLink
          key={n.to} to={n.to} onClick={onClick}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon" aria-hidden>{n.icon}</span>
          <span>{n.label}</span>
        </NavLink>
      ))}
    </>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { schoolId } = useSchool();
  const navigate = useNavigate();
  const online = useOnline();
  const [moreOpen, setMoreOpen] = useState(false);

  const isSuper = user?.role === 'superadmin';
  const isTeacher = user?.role === 'teacher';

  // O'qituvchi web'da faqat davomatni ko'radi.
  // Superadmin maktab tanlamaguncha maktab ichidagi bo'limlarni ko'rmaydi:
  // ular X-School-Id siz baribir "Maktab tanlanmagan" xatosini beradi.
  const schoolNav = isTeacher
    ? SCHOOL_NAV.filter((n) => n.to === '/attendance')
    : SCHOOL_NAV;
  const mainNav: NavItem[] = isSuper
    ? [SCHOOLS_NAV, ...(schoolId ? schoolNav : [])]
    : schoolNav;

  const allNav = [...mainNav, SETTINGS_NAV];
  const primary = allNav.slice(0, MOBILE_SLOTS);
  const overflow = allNav.slice(MOBILE_SLOTS);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">EduLive</div>
        <nav className="sidebar-nav">
          <NavItems items={mainNav} />
        </nav>
        <div className="sidebar-footer">
          <NavItems items={[SETTINGS_NAV]} />
        </div>
      </aside>

      <div className="content">
        {!online && (
          <div className="offline-banner" role="status">
            ⚠ Internet aloqasi yo'q — ma'lumotlar eskirgan bo'lishi mumkin
          </div>
        )}

        <header className="topbar">
          <div className="who">
            <strong>{user?.fullName}</strong>
            <span className="muted role">{roleLabel(user?.role)}</span>
          </div>
          {isSuper && schoolId && <ActiveSchool />}
          <div className="spacer" />
          <ThemeToggle />
          <button className="btn btn-ghost sm" onClick={() => { logout(); navigate('/login'); }}>
            Chiqish
          </button>
        </header>

        {/* Nega tugmalar yo'q — bir joyda tushuntiriladi. Backend ham shu
            chegarani majburlaydi (middleware/auth.ts -> platformReadOnly). */}
        {isSuper && schoolId && (
          <div className="readonly-banner" role="status">
            <span aria-hidden>👁</span>
            Ko'rish rejimi — maktab ma'lumotini o'zgartira olmaysiz. Xodimlar boshqaruvi ochiq.
          </div>
        )}

        <main>{children}</main>

        <nav className="mobile-nav">
          <NavItems items={primary} />
          {overflow.length > 0 && (
            <button
              className={`nav-item${moreOpen ? ' active' : ''}`}
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
            >
              <span className="nav-icon" aria-hidden>⋯</span>
              <span>Yana</span>
            </button>
          )}
        </nav>

        {/* Pastki panelga sig'magan bo'limlar. Gorizontal scroll o'rniga varaq:
            7-8 ta band 390px ga hech qanday holatda sig'maydi. */}
        {moreOpen && (
          <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
            <div className="sheet" role="dialog" aria-label="Boshqa bo'limlar">
              <div className="sheet-grab" aria-hidden />
              <NavItems items={overflow} onClick={() => setMoreOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
