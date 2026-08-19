import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth, useAuth } from './lib/auth';
import { useSchool } from './lib/school';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Schools from './pages/Schools';
import Students from './pages/Students';
import StudentCard from './pages/StudentCard';
import Attendance from './pages/Attendance';
import Payments from './pages/Payments';
import Debtors from './pages/Debtors';

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
                <Route path="/dashboard" element={<NeedsSchool><Dashboard /></NeedsSchool>} />
                <Route path="/students" element={<NeedsSchool><Students /></NeedsSchool>} />
                <Route path="/students/:id" element={<NeedsSchool><StudentCard /></NeedsSchool>} />
                <Route path="/attendance" element={<NeedsSchool><Attendance /></NeedsSchool>} />
                <Route path="/payments" element={<NeedsSchool><Payments /></NeedsSchool>} />
                <Route path="/debtors" element={<NeedsSchool><Debtors /></NeedsSchool>} />
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

function NotFound() {
  return (
    <main className="page">
      <h1>Sahifa topilmadi</h1>
      <p className="muted" style={{ marginTop: 6 }}>Manzilni tekshiring yoki bosh sahifaga qayting.</p>
    </main>
  );
}
