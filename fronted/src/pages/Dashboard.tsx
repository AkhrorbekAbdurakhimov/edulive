import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, money } from '../lib/api';
import { ErrorState, TileSkeleton } from '../components/ui';

interface DashboardData {
  students: { active: number };
  attendanceToday: {
    sessions: number; confirmed: number; total: number;
    present: number; absent: number; late: number; rate: number | null;
  };
  payments: { thisMonth: number };
  debtors: { count: number; outstanding: number };
}

export default function Dashboard() {
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardData>('/dashboard')).data,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Boshqaruv paneli</h1>
      </div>

      {q.isPending ? (
        <div className="stat-grid">
          <TileSkeleton /><TileSkeleton /><TileSkeleton /><TileSkeleton />
        </div>
      ) : q.isError ? (
        <div className="card"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
      ) : (
        <>
          <div className="stat-grid">
            <Link to="/attendance" className="card stat-tile">
              <div className="label">Bugungi davomat</div>
              <div className="value num">
                {q.data.attendanceToday.rate === null ? '—' : `${q.data.attendanceToday.rate}%`}
              </div>
              <div className="sub">
                {q.data.attendanceToday.sessions === 0
                  ? 'Bugun davomat hali olinmagan'
                  : `${q.data.attendanceToday.sessions} sinf, ${q.data.attendanceToday.confirmed} tasdiqlangan`}
              </div>
            </Link>

            <Link to="/attendance" className="card stat-tile">
              <div className="label">Kelmaganlar</div>
              <div className="value num">{q.data.attendanceToday.absent}</div>
              <div className="sub">kech qolganlar: {q.data.attendanceToday.late}</div>
            </Link>

            <Link to="/payments" className="card stat-tile">
              <div className="label">Shu oy tushumi</div>
              <div className="value num">{money(q.data.payments.thisMonth)}</div>
              <div className="sub">tasdiqlangan to'lovlar</div>
            </Link>

            {/* Qarz — neytral rangda, lekin eng ko'zga tashlanadigan raqam (4.1-qoida) */}
            <Link to="/debtors" className="card stat-tile">
              <div className="label">Umumiy qarzdorlik</div>
              <div className="value num">{money(q.data.debtors.outstanding)}</div>
              <div className="sub">{q.data.debtors.count} o'quvchi qarzdor</div>
            </Link>
          </div>

          <div className="card card-pad">
            <h2>Bugun</h2>
            <p className="muted">
              Faol o'quvchilar: <strong className="num">{q.data.students.active}</strong> ·
              {' '}Keldi: <strong className="num">{q.data.attendanceToday.present}</strong> ·
              {' '}Kelmadi: <strong className="num">{q.data.attendanceToday.absent}</strong> ·
              {' '}Kech qoldi: <strong className="num">{q.data.attendanceToday.late}</strong>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
