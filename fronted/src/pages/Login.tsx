import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('+998');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(phone.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Kirishda xatolik. Internetni tekshiring');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card card-pad" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--brand-ink)' }}>
          EduLive
        </div>
        <p className="muted" style={{ margin: '4px 0 20px' }}>Maktab boshqaruv tizimi</p>

        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="phone">Telefon raqam</label>
          <input
            id="phone" className={`input${error ? ' err' : ''}`} value={phone}
            onChange={(e) => setPhone(e.target.value)} autoComplete="username"
            placeholder="+998901234567" inputMode="tel"
          />
        </div>
        <div className="field" style={{ marginBottom: 18 }}>
          <label htmlFor="password">Parol</label>
          <input
            id="password" type="password" className={`input${error ? ' err' : ''}`} value={password}
            onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          />
          {error && <span className="hint">{error}</span>}
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !password}>
          {busy ? 'Kirilmoqda…' : 'Kirish'}
        </button>
      </form>
    </div>
  );
}
