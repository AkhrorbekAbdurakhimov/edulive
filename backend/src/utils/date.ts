/**
 * 2026-09-27 -> "27.09.2026".
 *
 * Foydalanuvchiga ketadigan matnlar (Telegram xabari, xato) uchun — bir joyda
 * turadi, aks holda har modul o'zicha formatlab, sanalar har xil ko'rinardi.
 * `date` ustunlari pool.ts da satr bo'lib qoladi, shuning uchun Date obyekti
 * yasalmaydi: vaqt mintaqasi sanani bir kunga surib yuborishi mumkin.
 */
export function uzDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
