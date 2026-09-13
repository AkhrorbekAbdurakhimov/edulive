/**
 * O'quvchini tahrirlash oynalari.
 *
 * Uchta alohida amal, backenddagi uchta endpointga 1:1 mos:
 *   PATCH /students/:id            — shaxsiy ma'lumot
 *   PATCH /students/:id/enrollment — sinf, oylik to'lov, chegirma (moliyaviy, auditga tushadi)
 *   POST  /students/:id/archive    — arxivlash
 *
 * Ular bitta "saqlash" ostida birlashtirilmagan: har biri alohida tranzaksiya
 * va moliyaviy o'zgarish shaxsiy ma'lumot bilan aralashib ketmasligi kerak.
 */
import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, date, fmtNum, money, parseAmount } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Modal } from './ui';

/** Chiqarishga to'sqinlik qiladigan qarzlar — GET /students/:id/leaving-check. */
interface LeavingCheck {
  blocked: boolean;
  message: string | null;
  overdue: number;
  outstanding: number;
  overdueInvoices: number;
  books: Array<{
    id: string; title: string; inventory_no: string;
    due_on: string; overdue: boolean; days_late: number;
  }>;
}

export interface EditableStudent {
  id: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  birth_date: string | null;
  gender: string | null;
  class_id: string | null;
  monthly_fee: number | null;
  discount_percent: number | null;
  discount_reason: string | null;
}

export function EditInfoModal({ s, onClose }: { s: EditableStudent; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    lastName: s.last_name,
    firstName: s.first_name,
    middleName: s.middle_name ?? '',
    birthDate: s.birth_date ? String(s.birth_date).slice(0, 10) : '',
    gender: s.gender ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/students/${s.id}`, {
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        // null yuborilsa maydon tozalanadi; undefined bo'lsa tegilmaydi.
        middleName: form.middleName.trim() || null,
        birthDate: form.birthDate || null,
        gender: form.gender || null,
      })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', s.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });

  const errMsg = (save.error as any)?.response?.data?.error;

  return (
    <Modal title="O'quvchi ma'lumotlari" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="form-grid">
          <div className="field">
            <label>Familiya</label>
            <input className="input" value={form.lastName} onChange={set('lastName')} required minLength={2} />
          </div>
          <div className="field">
            <label>Ism</label>
            <input className="input" value={form.firstName} onChange={set('firstName')} required minLength={2} />
          </div>
          <div className="field">
            <label>Otasining ismi</label>
            <input className="input" value={form.middleName} onChange={set('middleName')} />
          </div>
          <div className="field">
            <label>Tug'ilgan sana</label>
            <input className="input" type="date" value={form.birthDate} onChange={set('birthDate')} />
          </div>
          <div className="field">
            <label>Jinsi</label>
            <select className="input" value={form.gender} onChange={set('gender')}>
              <option value="">Ko'rsatilmagan</option>
              <option value="m">O'g'il</option>
              <option value="f">Qiz</option>
            </select>
          </div>
        </div>
        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EditClassModal({ s, onClose }: { s: EditableStudent; onClose: () => void }) {
  const qc = useQueryClient();
  const classes = useQuery({
    queryKey: ['classes'],
    queryFn: async () => (await api.get<{ items: Array<{ id: string; name: string }> }>('/classes')).data.items,
  });

  const [form, setForm] = useState({
    classId: s.class_id ?? '',
    monthlyFee: s.monthly_fee != null ? fmtNum(String(Math.round(s.monthly_fee))) : '',
    discountPercent: String(s.discount_percent ?? 0),
    discountReason: s.discount_reason ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        discountPercent: Number(form.discountPercent) || 0,
        discountReason: form.discountReason.trim() || null,
        // Bo'sh qoldirilsa sinf narxi ishlatiladi (null = sinfnikini olish).
        monthlyFee: form.monthlyFee.trim() ? parseAmount(form.monthlyFee) : null,
      };
      if (form.classId) body.classId = form.classId;
      return (await api.patch(`/students/${s.id}/enrollment`, body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', s.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      onClose();
    },
  });

  const disc = Number(form.discountPercent);
  const badDisc = !Number.isFinite(disc) || disc < 0 || disc > 100;
  const errMsg = (save.error as any)?.response?.data?.error;

  return (
    <Modal title="Sinf va to'lov" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!badDisc) save.mutate(); }}>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Sinf</label>
            <select className="input" value={form.classId} onChange={set('classId')}>
              <option value="">Tanlanmagan</option>
              {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!s.class_id && <span className="help">O'quvchi hali sinfga biriktirilmagan</span>}
          </div>
          <div className="field">
            <label>Oylik to'lov</label>
            <input
              className="input num" value={form.monthlyFee} inputMode="numeric"
              onChange={(e) => setForm((f) => ({ ...f, monthlyFee: fmtNum(e.target.value) }))}
              placeholder="sinf narxi"
            />
            <span className="help">Bo'sh qoldirilsa sinf narxi ishlatiladi</span>
          </div>
          <div className="field">
            <label>Chegirma %</label>
            <input
              className={`input num${badDisc ? ' err' : ''}`} value={form.discountPercent}
              onChange={set('discountPercent')} inputMode="numeric"
            />
            {badDisc && <span className="hint">0 dan 100 gacha</span>}
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Chegirma sababi</label>
            <input
              className="input" value={form.discountReason} onChange={set('discountReason')}
              placeholder="aka-uka, xodim farzandi, grant…"
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          To'lov va chegirma o'zgarishi audit jurnaliga yoziladi.
        </p>
        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={badDisc || save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * O'quvchini ro'yxatdan chiqarish yoki butunlay o'chirish.
 *
 * O'chirish faqat MOLIYAVIY TARIXI YO'Q o'quvchi uchun: students ga to'lov va
 * hisoblar CASCADE bilan bog'langan, ya'ni o'chirish ularni ham olib ketadi.
 * Ketgan o'quvchiga "Ketdi" ishlatiladi — tarixi saqlanib qoladi.
 */
export function ArchiveModal({ id, name, onClose, onDone }: {
  id: string; name: string; onClose: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [status, setStatus] = useState('left');
  const [endsOn, setEndsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [force, setForce] = useState(false);

  const done = () => { qc.invalidateQueries({ queryKey: ['students'] }); onDone(); };

  // Qarz oyna ochilishi bilan ko'rinadi — tugmani bosib xato olishdan oldin.
  const debt = useQuery({
    queryKey: ['leaving-check', id],
    queryFn: async () =>
      (await api.get<LeavingCheck>(`/students/${id}/leaving-check`)).data,
  });
  const blocked = debt.data?.blocked ?? false;

  const archive = useMutation({
    mutationFn: async () =>
      (await api.post(`/students/${id}/archive`, {
        status, endsOn, reason: reason.trim() || undefined,
        ...(blocked ? { force: true } : {}),
      })).data as { recalculated: number },
    onSuccess: done,
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/students/${id}`)).data,
    onSuccess: done,
  });

  const errMsg = ((archive.error ?? remove.error) as any)?.response?.data?.error;

  const LABEL: Record<string, string> = {
    left: "Ketdi — boshqa maktabga o'tdi",
    graduated: 'Bitirdi',
    archived: "Arxivga (sabab ko'rsatilmagan)",
  };

  return (
    <Modal title="Ro'yxatdan chiqarish" onClose={onClose}>
      <p><strong>{name}</strong> faol ro'yxatdan chiqadi.</p>
      <p className="muted">
        Sinfdagi biriktirish yopiladi va keyingi oylarga hisob chiqarilmaydi.
        Hisoblari va to'lovlari saqlanib qoladi.
      </p>

      {blocked && debt.data && (
        <div className="alarm" role="alert" style={{ marginTop: 12 }}>
          {/* Rang yolg'iz ma'no tashimaydi — ikonka va so'z birga. */}
          <span className="alarm-icon" aria-hidden>⚠</span>
          <div>
            <strong>Qarzi bor — avval yopilishi kerak</strong>
            <ul className="alarm-list">
              {debt.data.books.map((b) => (
                <li key={b.id}>
                  Qaytarilmagan kitob: {b.title} · <span className="num">{b.inventory_no}</span>
                  {' · muddat '}<span className="num">{date(b.due_on)}</span>
                  {b.overdue && <> · <strong>{b.days_late} kun kechikdi</strong></>}
                </li>
              ))}
              {debt.data.overdue > 0 && (
                <li>
                  To'lanmagan hisob: <span className="num">{money(debt.data.overdue)}</span>
                  {' '}({debt.data.overdueInvoices} ta oy)
                </li>
              )}
            </ul>
            <span>Kitob qaytarilsa va qarz to'lansa, chiqarish ochiladi.</span>
          </div>
        </div>
      )}

      {!blocked && (debt.data?.outstanding ?? 0) > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Muddati kelmagan hisob: <span className="num">{money(debt.data!.outstanding)}</span>.
          Chiqarilgandan keyin ham qarz saqlanib qoladi.
        </p>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="ar-status">Sabab</label>
        <select id="ar-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {Object.entries(LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="field">
        <label htmlFor="ar-date">Ketgan sana</label>
        <input id="ar-date" className="input" type="date" value={endsOn}
               onChange={(e) => setEndsOn(e.target.value)} />
        <span className="help">
          Oy ulushi sozlamasi yoqilgan bo'lsa, shu oyning hisobi o'qilgan
          kunlarga qarab qayta hisoblanadi.
        </span>
      </div>

      <div className="field">
        <label htmlFor="ar-note">Izoh (ixtiyoriy)</label>
        <input id="ar-note" className="input" value={reason}
               onChange={(e) => setReason(e.target.value)} />
      </div>

      {/* Qarzni kechirish emas, istisno: bola shahardan ketib qolgan bo'lishi
          mumkin. Faqat admin va audit jurnaliga summasi bilan yoziladi. */}
      {blocked && user?.role === 'admin' && (
        <label className="check-row">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <span>
            Qarz bilan chiqarilsin
            <span className="help">
              Qarz o'chmaydi — hisob ochiq qoladi va qarzdorlar ro'yxatida turadi.
              Kim chiqargani audit jurnaliga yoziladi.
            </span>
          </span>
        </label>
      )}

      {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}

      <div className="actions">
        <button className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
        <button
          className="btn btn-danger"
          onClick={() => archive.mutate()}
          disabled={archive.isPending || debt.isPending || (blocked && !force)}
        >
          {archive.isPending ? 'Bajarilmoqda…' : "Ro'yxatdan chiqarish"}
        </button>
      </div>

      <hr className="sep" />
      {!confirmDelete ? (
        <button type="button" className="btn btn-ghost sm" onClick={() => setConfirmDelete(true)}>
          Butunlay o'chirish
        </button>
      ) : (
        <div>
          <p className="hint" style={{ marginTop: 0 }}>
            Butunlay o'chirish qaytarib bo'lmaydi. Faqat xato kiritilgan yozuv uchun —
            to'lovi yoki hisobi bo'lsa tizim ruxsat bermaydi.
          </p>
          <div className="row">
            <button type="button" className="btn btn-secondary sm" onClick={() => setConfirmDelete(false)}>
              Bekor qilish
            </button>
            <button
              type="button" className="btn btn-danger sm"
              onClick={() => remove.mutate()} disabled={remove.isPending}
            >
              {remove.isPending ? "O'chirilmoqda…" : "Ha, butunlay o'chirilsin"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
