/**
 * Maktabga Telegram bot biriktirish (superadmin).
 *
 * Token bir marta kiritiladi va qaytib ko'rsatilmaydi — u serverda shifrlab
 * saqlanadi va javoblarda hech qachon qaytarilmaydi.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Chip, ErrorState } from './ui';

interface BotStatus {
  own: boolean;
  username: string | null;
  webhookSet: boolean;
  platformBot: string | null;
  canEncrypt: boolean;
}

export function SchoolBot({ schoolId }: { schoolId: string }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');

  const status = useQuery({
    queryKey: ['school-bot', schoolId],
    queryFn: async () => (await api.get<BotStatus>(`/schools/${schoolId}/telegram`)).data,
  });

  const connect = useMutation({
    mutationFn: async () => (await api.put(`/schools/${schoolId}/telegram`, { token: token.trim() })).data,
    onSuccess: () => {
      setToken('');
      qc.invalidateQueries({ queryKey: ['school-bot', schoolId] });
      qc.invalidateQueries({ queryKey: ['schools'] });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => (await api.delete(`/schools/${schoolId}/telegram`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['school-bot', schoolId] });
      qc.invalidateQueries({ queryKey: ['schools'] });
    },
  });

  const errMsg =
    (connect.error as any)?.response?.data?.error ??
    (disconnect.error as any)?.response?.data?.error;

  if (status.isPending) return <div className="skeleton" style={{ width: '60%' }} />;

  // Xato holati alohida bo'lishi SHART: busiz so'rov yiqilganda quyidagi
  // `s?.canEncrypt` false chiqib, panel "SECRET_KEY sozlanmagan" deb
  // yozardi — ya'ni tarmoq uzilishi server nosozligidek ko'rinardi.
  if (status.isError) {
    return (
      <div className="bot-box">
        <strong style={{ fontSize: 14 }}>Telegram bot</strong>
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      </div>
    );
  }

  const s = status.data;

  return (
    <div className="bot-box">
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>Telegram bot</strong>
        {s?.own
          ? <Chip kind="good">@{s.username}</Chip>
          : <Chip kind="neutral">Platforma boti</Chip>}
        {s?.own && !s.webhookSet && (
          /* HTTPS manzil bo'lmasa Telegram webhook o'rnatilmaydi (lokal ishlab
             chiqishda normal holat) — lekin production'da bu xabar kelmasligi kerak. */
          <Chip kind="warn">Webhook o'rnatilmagan</Chip>
        )}
      </div>

      {!s?.own && (
        <p className="muted" style={{ marginTop: 0 }}>
          Hozir {s?.platformBot ? <>@{s.platformBot}</> : 'platforma boti'} ishlatilyapti.
          Maktab o'z botini ulasa, ota-onalar maktab nomidagi botga yozadi.
        </p>
      )}

      {!s?.canEncrypt && (
        <p className="hint">
          Serverda SECRET_KEY sozlanmagan — token shifrlab saqlanmaydi, shuning uchun
          bot ulash o'chirilgan.
        </p>
      )}

      {s?.own ? (
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button
            type="button" className="btn btn-secondary sm"
            onClick={() => disconnect.mutate()} disabled={disconnect.isPending}
          >
            {disconnect.isPending ? 'Uzilmoqda…' : 'Botni uzish'}
          </button>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="bot-token">BotFather bergan token</label>
          <input
            id="bot-token" className="input" type="password" autoComplete="off"
            value={token} onChange={(e) => setToken(e.target.value)}
            placeholder="123456789:AA..." disabled={!s?.canEncrypt}
          />
          <span className="help">
            Telegramda @BotFather ga /newbot yozing, bot nomini tanlang va bergan
            tokenni shu yerga qo'ying. Token bir marta kiritiladi va qayta ko'rsatilmaydi.
          </span>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button" className="btn btn-secondary sm"
              onClick={() => connect.mutate()}
              disabled={!token.trim() || !s?.canEncrypt || connect.isPending}
            >
              {connect.isPending ? 'Tekshirilmoqda…' : 'Botni ulash'}
            </button>
          </div>
        </div>
      )}

      {errMsg && <p className="hint">{errMsg}</p>}
    </div>
  );
}
