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
import { api, fmtNum, parseAmount } from '../lib/api';
import { Modal } from './ui';

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

export function ArchiveModal({ id, name, onClose, onDone }: {
  id: string; name: string; onClose: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const archive = useMutation({
    mutationFn: async () =>
      (await api.post(`/students/${id}/archive`, { reason: reason.trim() || undefined })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['students'] }); onDone(); },
  });
  const errMsg = (archive.error as any)?.response?.data?.error;

  return (
    <Modal title="O'quvchini arxivlash" onClose={onClose}>
      <p><strong>{name}</strong> arxivga o'tkaziladi.</p>
      <p className="muted">
        Ro'yxatdan chiqadi va sinfdagi biriktirish yopiladi. Hisoblari va
        to'lovlari saqlanib qoladi — o'chirilmaydi.
      </p>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Sabab (ixtiyoriy)</label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
      <div className="actions">
        <button className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
        <button className="btn btn-danger" onClick={() => archive.mutate()} disabled={archive.isPending}>
          {archive.isPending ? 'Arxivlanmoqda…' : 'Arxivlash'}
        </button>
      </div>
    </Modal>
  );
}
