/**
 * 1200000 -> "1 200 000 so'm".
 *
 * Foydalanuvchiga ketadigan matnlar (xato, Telegram xabari) uchun — bir joyda
 * turadi, aks holda har modul o'zicha formatlab, summalar har xil ko'rinardi.
 */
export function uzSum(n: number): string {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}
