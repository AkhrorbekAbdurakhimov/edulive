import { Routes, Route, Navigate } from 'react-router-dom';
import { RequireAuth } from './lib/auth';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
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
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/students" element={<Students />} />
                <Route path="/students/:id" element={<StudentCard />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/payments" element={<Payments />} />
                <Route path="/debtors" element={<Debtors />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="page">
      <h1>Sahifa topilmadi</h1>
      <p className="muted" style={{ marginTop: 6 }}>Manzilni tekshiring yoki bosh sahifaga qayting.</p>
    </main>
  );
}
