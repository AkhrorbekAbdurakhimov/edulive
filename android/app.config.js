/**
 * app.json ustiga muhitga bog'liq qiymatlar.
 *
 * - API_URL: lokal dev'da app.json'dagi emulyator manzili (10.0.2.2) qoladi;
 *   CI release APK uchun https://edulive.uz/api beradi. Manzil kodga
 *   "pishirilmaydi", chunki bitta APK bir nechta muhitga yig'iladi.
 * - ANDROID_VERSION_CODE: har CI build'da oshadi (run_number), aks holda
 *   telefon eski versiya ustiga yangisini o'rnatishdan bosh tortadi.
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    versionCode: Number(process.env.ANDROID_VERSION_CODE ?? config.android?.versionCode ?? 1),
  },
  extra: {
    ...config.extra,
    apiUrl: process.env.API_URL ?? config.extra?.apiUrl,
  },
});
