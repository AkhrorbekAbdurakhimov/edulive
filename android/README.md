# EduLive — o'qituvchi ilovasi (React Native + Expo)

```bash
npm install
npx expo start          # QR kodni Expo Go bilan skanerlang
npm run android         # emulyator/qurilmada
npm run typecheck
```

Emulyatorda backend manzili `http://10.0.2.2:4000/api` (app.json → extra.apiUrl).
Haqiqiy telefonda Expo Go bilan — kompyuterning LAN IP sini yozing.

Seed hisob: `+998901112244 / teacher123` (backend `npm run db:reset`).

## Nima uchun Expo

Backend va web bilan bir xil til (TypeScript) va bir xil tiplar. Tokenlar
`src/theme.ts` da — web'dagi `tokens.css` bilan **bir xil qiymatlar**.

## Ekranlar (maket: `../development/mobile-ui.dc.html`)

| Tab / ekran | Fayl | Maketdagi raqam |
|---|---|---|
| Kirish | `screens/LoginScreen.tsx` | — |
| Bugun — sinflar + bugungi davomat holati, KPI, navbat kartalari | `screens/HomeScreen.tsx` | 1, 6 |
| Davomat olish → tasdiqlash oynasi → natija | `screens/AttendanceScreen.tsx` | 2, 3, 4, 6 |
| Sinflar → sinf kartasi (oylik davomat yig'masi) | `screens/ClassesScreen.tsx`, `ClassDetailScreen.tsx` | — |
| Profil — parol, navbat, chiqish | `screens/ProfileScreen.tsx` | — |

Maketdan farqlar (backend mantiqiga moslab) — `development/DECISIONS.md`
"Android" bo'limida.

## Tuzilish

```
App.tsx           tablar + ustki ekranlar (stack), orqaga tugmasi, kirish holati
src/api.ts        fetch, token (SecureStore), oflayn kesh (cachedGet), 401 → chiqish
src/queries.ts    TanStack Query hooklari va server tiplari
src/store.ts      qoralama va navbat (AsyncStorage), flushQueue
src/net.ts        NetInfo: onlayn holat, aloqa qaytganda navbatni yuborish
src/ui.tsx        umumiy komponentlar (BigButton, Pill, Sheet, ThumbZone, ...)
src/format.ts     sana/ism formatlari (o'zbek)
src/theme.ts      tokenlar, HIT, radius, ThemeContext
```

## Asosiy qoidalar

1. **Davomatda sukut holati "Keldi".** O'qituvchi faqat kelmaganlarni bosadi
   (Keldi → Kelmadi → Kech qoldi → Keldi). Kech qolganda uzoq bosish —
   daqiqani belgilash (ota-onaga "18 daqiqa kechikdi" deb boradi).
2. **Tasdiqlash tugmasi doim bosh barmoq zonasida** (`ThumbZone`).
3. **Oflayn-first.** Sinf va o'quvchilar ro'yxati telefonda keshlanadi
   (`cachedGet`), shuning uchun internet bo'lmasa ham davomat olinadi.
   Tasdiqlangan davomat navbatga tushadi; aloqa qaytganda yoki ilova
   oldinga chiqqanda `flushQueue` yuboradi. Ota-onaga xabar faqat server
   tasdiqlagandan keyin ketadi. Server rad etgan yozuv **yo'qolmaydi** —
   Bugun ekranida sababi bilan ko'rinadi (qayta urinish / o'chirish).
4. **Teginish nishoni ≥ 44dp** (`HIT`).
5. Orqaga tugmasi tasdiqlanmagan davomatni yo'qotmaydi — qoralama har
   bosishda saqlanadi.
6. Tahrir oynasi (3 soat) **serverdan** keladi (`editableUntil`) — ilovada
   soat soni yozilmagan.
7. Navbatda yuborilmagan davomat bo'lsa **chiqish bloklanadi** — token
   o'chsa u yuborilmay qoladi.
