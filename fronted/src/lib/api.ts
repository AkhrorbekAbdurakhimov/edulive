import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('edulive_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Superadmin boshqa maktabga kirganda:
  const impersonated = localStorage.getItem('edulive_school_id');
  if (impersonated) config.headers['X-School-Id'] = impersonated;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401) {
      localStorage.removeItem('edulive_token');
      if (location.pathname !== '/login') location.assign('/login');
    }
    return Promise.reject(error);
  },
);

/** 1 200 000 so'm — bo'sh joy ajratgich, valyuta oxirida. */
export const money = (n: number) =>
  `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;

/** 09.08.2026 */
export const date = (d: string | Date) =>
  new Date(d).toLocaleDateString('ru-RU').replace(/\//g, '.');

/**
 * Summa maydoni uchun: yozilayotgan paytda 2000000 -> "2 000 000".
 * Raqamdan boshqa hamma narsa tashlanadi, shuning uchun natijani
 * o'qishda faqat bo'shliqlarni olib tashlash kifoya (parseAmount).
 */
export const fmtNum = (v: string) =>
  v.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** fmtNum ning teskarisi: "2 000 000" -> 2000000 */
export const parseAmount = (v: string) => Number(v.replace(/\s/g, '')) || 0;

const MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

/** "2026-09-01" -> "Sentabr 2026". pg date ustuni satr bo'lib keladi. */
export const monthLabel = (d: string) => {
  const [y, m] = d.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};
