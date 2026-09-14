import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Modal, initials } from './ui';

export interface GuardianPhone {
  id: string;
  phone: string;
  isPrimary: boolean;
  telegramLinked: boolean;
  /** none — ulanmagan · pending — tasdiq kutilmoqda · confirmed · rejected */
  telegramState?: 'none' | 'pending' | 'confirmed' | 'rejected';
  notifyEnabled: boolean;
}

export interface Guardian {
  id: string;
  full_name: string;
  relation: string | null;
  is_primary: boolean;
  phones: GuardianPhone[];
}

export const REL: Record<string, string> = {
  father: 'Otasi', mother: 'Onasi', guardian: 'Vasiy',
};

const errOf = (e: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any)?.response?.data?.error ?? 'Amalni bajarib bo\'lmadi';

/**
 * O'quvchining mas'ul shaxslari.
 *
 * Har bir raqam ALOHIDA Telegram chatiga ulanadi va har biriga xabar boradi —
 * shuning uchun raqamlar ro'yxat ko'rinishida, har birining holati bilan.
 */
export function Guardians(
  { studentId, guardians, readOnly }:
  { studentId: string; guardians: Guardian[]; readOnly: boolean },
) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Guardian | null>(null);
  const [addPhoneTo, setAddPhoneTo] = useState<Guardian | null>(null);
  const [editPhone, setEditPhone] = useState<{ guardian: Guardian; phone: GuardianPhone } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['student', studentId] });

  const removeGuardian = useMutation({
    mutationFn: async (parentId: string) =>
      (await api.delete(`/students/${studentId}/parents/${parentId}`)).data,
    onSuccess: () => { setNote(null); refresh(); },
    onError: (e) => setNote(errOf(e)),
  });

  const removePhone = useMutation({
    mutationFn: async (v: { parentId: string; phoneId: string }) =>
      (await api.delete(`/students/parents/${v.parentId}/phones/${v.phoneId}`)).data,
    onSuccess: () => { setNote(null); refresh(); },
    onError: (e) => setNote(errOf(e)),
  });

  const patchPhone = useMutation({
    mutationFn: async (v: { parentId: string; phoneId: string; body: Record<string, boolean> }) =>
      (await api.patch(`/students/parents/${v.parentId}/phones/${v.phoneId}`, v.body)).data,
    onSuccess: () => { setNote(null); refresh(); },
    onError: (e) => setNote(errOf(e)),
  });

  return (
    <div className="card card-pad">
      <div className="row" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Mas'ul shaxslar</h2>
        <div className="grow" />
        {!readOnly && (
          <button className="btn btn-secondary sm" onClick={() => setAdding(true)}>
            + Mas'ul shaxs
          </button>
        )}
      </div>

      {guardians.length === 0 ? (
        <p className="muted">
          Mas'ul shaxs qo'shilmagan — bu o'quvchi bo'yicha hech kimga xabar bormaydi.
        </p>
      ) : (
        guardians.map((g) => (
          <div key={g.id} className="guardian">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="avatar">{initials(g.full_name)}</span>
              <div className="grow">
                <div>
                  <strong>{g.full_name}</strong>{' '}
                  {g.is_primary && <span className="chip neutral">asosiy</span>}
                </div>
                <div className="muted">{g.relation ? REL[g.relation] : "kim bo'lishi ko'rsatilmagan"}</div>

                <ul className="phone-list">
                  {g.phones.map((ph) => (
                    <li key={ph.id}>
                      <span className="num">{ph.phone}</span>
                      {ph.isPrimary && <span className="chip neutral">asosiy</span>}
                      {/* Botga ulanmagan yoki tasdiqlanmagan raqamga xabar bormaydi —
                          buni ko'rsatmasak "nega xabar kelmadi?" degan savol
                          javobsiz qolardi. */}
                      {tgChip(ph)}
                      {!ph.notifyEnabled && <span className="chip neutral">xabar o'chirilgan</span>}

                      {!readOnly && (
                        <span className="phone-actions">
                          {!ph.isPrimary && (
                            <button
                              type="button" className="btn btn-ghost sm"
                              onClick={() => patchPhone.mutate({
                                parentId: g.id, phoneId: ph.id, body: { isPrimary: true },
                              })}
                            >
                              Asosiy qilish
                            </button>
                          )}
                          <button
                            type="button" className="btn btn-ghost sm"
                            onClick={() => setEditPhone({ guardian: g, phone: ph })}
                          >
                            Raqamni o'zgartirish
                          </button>
                          <button
                            type="button" className="btn btn-ghost sm"
                            onClick={() => patchPhone.mutate({
                              parentId: g.id, phoneId: ph.id,
                              body: { notifyEnabled: !ph.notifyEnabled },
                            })}
                          >
                            {ph.notifyEnabled ? "Xabarni o'chirish" : 'Xabarni yoqish'}
                          </button>
                          {g.phones.length > 1 && (
                            <button
                              type="button" className="btn btn-ghost sm"
                              onClick={() => removePhone.mutate({ parentId: g.id, phoneId: ph.id })}
                            >
                              O'chirish
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                {!readOnly && (
                  <div className="row">
                    <button
                      type="button" className="btn btn-ghost sm"
                      onClick={() => setEditing(g)}
                    >
                      Tahrirlash
                    </button>
                    <button
                      type="button" className="btn btn-ghost sm"
                      onClick={() => setAddPhoneTo(g)}
                    >
                      + Qo'shimcha raqam
                    </button>
                    <button
                      type="button" className="btn btn-ghost sm"
                      onClick={() => removeGuardian.mutate(g.id)}
                      disabled={removeGuardian.isPending}
                    >
                      Ro'yxatdan chiqarish
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {note && <p className="hint">{note}</p>}

      {adding && <AddGuardianModal studentId={studentId} onClose={() => setAdding(false)} />}
      {editing && (
        <EditGuardianModal
          studentId={studentId} guardian={editing} onClose={() => setEditing(null)}
        />
      )}
      {addPhoneTo && (
        <AddPhoneModal
          studentId={studentId} guardian={addPhoneTo} onClose={() => setAddPhoneTo(null)}
        />
      )}
      {editPhone && (
        <EditPhoneModal
          studentId={studentId} guardian={editPhone.guardian} phone={editPhone.phone}
          onClose={() => setEditPhone(null)}
        />
      )}
    </div>
  );
}

/**
 * Mas'ul shaxsni tahrirlash: ismi, qarindoshligi, asosiyligi.
 *
 * Raqamlar bu yerda emas — ular ro'yxatda alohida boshqariladi: har raqam
 * alohida Telegram chati va o'chirish qoidalari boshqacha.
 */
function EditGuardianModal(
  { studentId, guardian, onClose }:
  { studentId: string; guardian: Guardian; onClose: () => void },
) {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(guardian.full_name);
  const [relation, setRelation] = useState(guardian.relation ?? 'father');
  const [isPrimary, setIsPrimary] = useState(guardian.is_primary);

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/students/${studentId}/parents/${guardian.id}`, {
        fullName: fullName.trim(),
        relation,
        isPrimary,
      })).data as { children: number },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', studentId] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });

  const shortName = fullName.trim().length < 3;

  return (
    <Modal title="Mas'ul shaxsni tahrirlash" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="field">
          <label htmlFor="eg-name">F.I.Sh.</label>
          <input
            id="eg-name" className="input" value={fullName}
            onChange={(e) => setFullName(e.target.value)} required
          />
          {shortName && <span className="hint">Kamida 3 belgi</span>}
        </div>

        <div className="field">
          <label htmlFor="eg-rel">Kim bo'ladi</label>
          <select
            id="eg-rel" className="input" value={relation}
            onChange={(e) => setRelation(e.target.value)}
          >
            {Object.entries(REL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>

        <label className="check-row">
          <input
            type="checkbox" checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
          <span>
            Asosiy mas'ul shaxs
            <span className="help">
              Ro'yxatlarda va hisobotlarda shu odam ko'rsatiladi. Faqat shu
              o'quvchi uchun — boshqa farzandiga ta'sir qilmaydi.
            </span>
          </span>
        </label>

        {/* Ism va qarindoshlik ODAMGA tegishli: aka-ukaga ham biriktirilgan
            bo'lsa, o'zgarish ularda ham ko'rinadi. */}
        <p className="help" style={{ marginTop: 10 }}>
          Ism va qarindoshlik o'zgarishi bu odam biriktirilgan barcha
          farzandlarda ko'rinadi. Telefon raqamlari bu yerda o'zgarmaydi.
        </p>

        {save.error != null && <p className="hint">{errOf(save.error)}</p>}

        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={shortName || save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Telefon raqamini o'zgartirish.
 *
 * Botga ulangan raqam o'zgarsa ulanish uziladi — buni oldindan aytamiz:
 * kutubxonachi yoki menejer "raqamni tuzatdim, xabar nega kelmayapti?" degan
 * holatga tushmasin. Ota-ona yangi raqami bilan qaytadan ulanadi.
 */
function EditPhoneModal(
  { studentId, guardian, phone, onClose }:
  { studentId: string; guardian: Guardian; phone: GuardianPhone; onClose: () => void },
) {
  const qc = useQueryClient();
  const [value, setValue] = useState(phone.phone);
  const linked = (phone.telegramState ?? (phone.telegramLinked ? 'confirmed' : 'none')) !== 'none';

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/students/parents/${guardian.id}/phones/${phone.id}`, {
        phone: value.trim(),
      })).data as { telegramUnlinked: boolean },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', studentId] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });

  const same = value.trim() === phone.phone;

  return (
    <Modal title="Telefon raqamini o'zgartirish" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>{guardian.full_name}</strong> — hozirgi raqam{' '}
          <span className="num">{phone.phone}</span>
        </p>

        <div className="field">
          <label htmlFor="ep-phone">Yangi raqam</label>
          <input
            id="ep-phone" className="input num" value={value} inputMode="tel"
            onChange={(e) => setValue(e.target.value)} placeholder="+998901234567" required
          />
        </div>

        {linked && !same && (
          <div className="alarm" role="alert">
            {/* Rang yolg'iz ma'no tashimaydi — ikonka va so'z birga. */}
            <span className="alarm-icon" aria-hidden>⚠</span>
            <div>
              <strong>Telegram ulanishi uziladi</strong>
              <span>
                Bu raqam botga ulangan. Raqam o'zgarishi bilan ulanish darhol
                uziladi va bu ota-onaga xabar bormaydi. U yangi raqami bilan
                botni ochib, farzandini qaytadan tasdiqlashi kerak.
              </span>
            </div>
          </div>
        )}

        {save.error != null && <p className="hint">{errOf(save.error)}</p>}

        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn btn-primary" disabled={same || save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AddGuardianModal(
  { studentId, onClose }: { studentId: string; onClose: () => void },
) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: '', phone: '+998', extra: '', relation: 'father', isPrimary: false,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const phones = [form.phone.trim(), ...(form.extra.trim() ? [form.extra.trim()] : [])];
      return (await api.post(`/students/${studentId}/parents`, {
        fullName: form.fullName.trim(),
        phones,
        relation: form.relation,
        isPrimary: form.isPrimary,
      })).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['student', studentId] }); onClose(); },
  });

  return (
    <Modal title="Mas'ul shaxs qo'shish" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="g-name">F.I.Sh</label>
            <input id="g-name" className="input" value={form.fullName}
                   onChange={set('fullName')} required minLength={3} />
          </div>
          <div className="field">
            <label htmlFor="g-rel">Kim bo'ladi</label>
            <select id="g-rel" className="input" value={form.relation} onChange={set('relation')}>
              {Object.entries(REL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="g-phone">Telefon</label>
            <input id="g-phone" className="input num" value={form.phone}
                   onChange={set('phone')} inputMode="tel" required />
          </div>
          <div className="field">
            <label htmlFor="g-extra">Qo'shimcha telefon</label>
            <input id="g-extra" className="input num" value={form.extra}
                   onChange={set('extra')} inputMode="tel" placeholder="ixtiyoriy" />
            <span className="help">Har bir raqam alohida botga ulanadi va xabar oladi.</span>
          </div>
        </div>

        <label className="check-row">
          <input type="checkbox" checked={form.isPrimary}
                 onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} />
          <span>
            Asosiy mas'ul shaxs
            <span className="help">Ro'yxatlarda va qo'ng'iroq uchun shu ko'rsatiladi</span>
          </span>
        </label>

        {save.error && <p className="hint">{errOf(save.error)}</p>}

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

function AddPhoneModal(
  { studentId, guardian, onClose }:
  { studentId: string; guardian: Guardian; onClose: () => void },
) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState('+998');

  const save = useMutation({
    mutationFn: async () =>
      (await api.post(`/students/parents/${guardian.id}/phones`, { phone: phone.trim() })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['student', studentId] }); onClose(); },
  });

  return (
    <Modal title={`${guardian.full_name} — qo'shimcha raqam`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <div className="field">
          <label htmlFor="ph-new">Telefon</label>
          <input id="ph-new" className="input num" value={phone}
                 onChange={(e) => setPhone(e.target.value)} inputMode="tel" required autoFocus />
          <span className="help">
            Bu raqam ham alohida botga ulanishi va xabar olishi mumkin.
          </span>
        </div>

        {save.error && <p className="hint">{errOf(save.error)}</p>}

        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : "Qo'shish"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Raqamning Telegram holati.
 *
 * "Tasdiqlanmadi" eng muhimi: ota-ona botda "bu mening farzandim emas" degan,
 * ya'ni raqam yoki biriktirish xato. Bu holat ko'rinmasa, xabarlar jimgina
 * to'xtab qolardi.
 */
function tgChip(ph: GuardianPhone) {
  const state = ph.telegramState ?? (ph.telegramLinked ? 'confirmed' : 'none');
  if (state === 'confirmed') return <span className="chip good">✓ Telegram</span>;
  if (state === 'rejected') return <span className="chip crit">✕ Tasdiqlamadi</span>;
  if (state === 'pending') return <span className="chip warn">◔ Tasdiq kutilmoqda</span>;
  return <span className="chip warn">Botga ulanmagan</span>;
}
