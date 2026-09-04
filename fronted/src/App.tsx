import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, useAuth, useCanLibrary } from './lib/auth';
import { useSchool } from './lib/school';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Schools from './pages/Schools';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Classes from './pages/Classes';
import Students from './pages/Students';
import StudentCard from './pages/StudentCard';
// VAQTINCHALIK O'CHIRILGAN: import Attendance from './pages/Attendance';
import Payments from './pages/Payments';
import Debtors from './pages/Debtors';
import Notifications from './pages/Notifications';
import Library from './pages/Library';

/** Marshrutlar development/DESIGN_PROMPT.md dagi ekranlarga mos keladi. */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/schools" element={<SuperadminOnly><Schools /></SuperadminOnly>} />
                {/* Sozlamalar hamma rolga ochiq va maktab konteksti talab qilmaydi. */}
                <Route path="/settings" element={<Settings />} />
                <Route path="/dashboard" element={<NeedsSchool><Dashboard /></NeedsSchool>} />
                <Route path="/classes" element={<NeedsSchool><Classes /></NeedsSchool>} />
                <Route path="/students" element={<NeedsSchool><Students /></NeedsSchool>} />
                <Route path="/students/:id" element={<NeedsSchool><StudentCard /></NeedsSchool>} />
                {/* VAQTINCHALIK O'CHIRILGAN — davomat web'da vaqtincha yopilgan.
                    Backend endpointlari va mobil ilova tegilmagan. */}
                {/* <Route path="/attendance" element={<NeedsSchool><Attendance /></NeedsSchool>} /> */}
                <Route path="/payments" element={<NeedsSchool><Payments /></NeedsSchool>} />
                <Route path="/debtors" element={<NeedsSchool><Debtors /></NeedsSchool>} />
                <Route path="/notifications" element={<NeedsSchool><StaffOnly><Notifications /></StaffOnly></NeedsSchool>} />
                <Route path="/library" element={<NeedsSchool><LibraryOnly><Library /></LibraryOnly></NeedsSchool>} />
                <Route path="/users" element={<NeedsSchool><StaffOnly><Users /></StaffOnly></NeedsSchool>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

/** Superadmin maktab tanlamaguncha uy sahifasi — maktablar ro'yxati. */
function Home() {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  const toSchools = user?.role === 'superadmin' && !schoolId;
  return <Navigate to={toSchools ? '/schools' : '/dashboard'} replace />;
}

function SuperadminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== 'superadmin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/**
 * Maktab konteksti bo'lmasa bu sahifalar backend'dan "Maktab tanlanmagan"
 * xatosini oladi — foydalanuvchini xato o'rniga maktab tanlashga yo'naltiramiz.
 */
function NeedsSchool({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { schoolId } = useSchool();
  if (user?.role === 'superadmin' && !schoolId) return <Navigate to="/schools" replace />;
  return <>{children}</>;
}

/**
 * Kutubxona: admin/menejer, yoki kutubxonachi belgisi qo'yilgan xodim.
 *
 * Backend baribir 403 beradi, lekin qo'riqchisiz sahifa qobig'i ochilib,
 * "+ Kitob berish" tugmalari ko'rinib turardi — ishlamaydigan tugma
 * ko'rsatishdan ko'ra ochiq aytgan yaxshi.
 */
function LibraryOnly({ children }: { children: React.ReactNode }) {
  const canLibrary = useCanLibrary();
  if (!canLibrary) return <Navigate to="/settings" replace />;
  return <>{children}</>;
}

/** Xodimlar ro'yxati o'qituvchiga yopiq — backend ham unga 403 beradi. */
function StaffOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Davomat yopiq — o'qituvchi web'da faqat sozlamalarini ochadi.
  if (user?.role === 'teacher') return <Navigate to="/settings" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <main className="page">
      <h1>Sahifa topilmadi</h1>
      <p className="muted" style={{ marginTop: 6 }}>Manzilni tekshiring yoki bosh sahifaga qayting.</p>
    </main>
  );
}
