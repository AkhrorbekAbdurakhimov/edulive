# EduLive — maktab xodimlari ilovasi (React Native + Expo)

Kim kiradi: **o'qituvchi, menejer, administrator**. Superadmin faqat web orqali (DECISIONS M9).

```bash
npm install
npx expo start          # QR kodni Expo Go bilan skanerlang
npm run android         # emulyator/qurilmada
npm run typecheck
```

Emulyatorda backend manzili `http://10.0.2.2:4000/api` (app.json → extra.apiUrl).
Haqiqiy telefonda Expo Go bilan — kompyuterning LAN IP sini yozing.

Seed hisoblar: o'qituvchi `+998901112244 / teacher123`, admin `+998901112233 / admin123` (backend `npm run db:reset`).

## Nima uchun Expo

Backend va web bilan bir xil til (TypeScript) va bir xil tiplar. Tokenlar
`src/theme.ts` da — web'dagi `tokens.css` bilan **bir xil qiymatlar**.

## Bo'limlar (web bilan bir xil, rolga qarab — DECISIONS M11)

| Bo'lim | Kim ko'radi | Fayl |
|---|---|---|
| Boshqaruv (KPI plitkalar) | admin, menejer | `screens/DashboardScreen.tsx` |
| Davomat (Bugun → davomat olish → tasdiqlash) | hamma | `screens/HomeScreen.tsx`, `AttendanceScreen.tsx` |
| Sinflar → sinf kartasi (oylik yig'ma); admin: sinf/o'quv yili | hamma | `screens/ClassesScreen.tsx`, `ClassDetailScreen.tsx`, `ClassForms.tsx` |
| O'quvchilar → karta (moliya, hisoblar, ota-ona, kitoblar, tahrir, arxiv) | admin, menejer | `screens/StudentsScreen.tsx`, `StudentCardScreen.tsx`, `StudentForms.tsx` |
| To'lovlar (qabul qilish, oylar, kvitansiya, hisob chiqarish) | admin, menejer | `screens/PaymentsScreen.tsx` |
| Qarzdorlar (+eslatma) | admin, menejer | `screens/DebtorsScreen.tsx` |
| Xabarlar (bot havolasini ulashish, qayta yuborish) | admin, menejer | `screens/NotificationsScreen.tsx` |
| Kutubxona (kitoblar, berish, qabul qilish, kitob kartasi) | admin, menejer, kutubxonachi | `screens/LibraryScreen.tsx`, `BookDetailScreen.tsx`, `LibraryForms.tsx` |
| Xodimlar (admin tahrirlaydi, menejer ko'radi) | admin, menejer | `screens/UsersScreen.tsx` |
| Profil (ism/telefon, parol, chiqish) | hamma | `screens/ProfileScreen.tsx` |

Pastki panel: 3 bo'lim + "Yana" varaqasi (`App.tsx` → `navFor`). Umumiy forma
qismlari (`SearchPicker`, `Select`, `FormSheet`, `MoneyField`, `Chips`) —
`src/forms.tsx`. Excel import faqat web'da.

Maket: `../development/mobile-ui.dc.html` (davomat ekranlari 1–4, 6).

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
8. **O'z-o'zini yangilash** (`src/update.ts`): ishga tushganda GitHub
   Release'dagi oxirgi `android-v<ver>-<versionCode>` tegi tekshiriladi;
   kattaroq bo'lsa sheet chiqadi → APK keshga yuklanadi → Android
   o'rnatuvchisi ochiladi (`REQUEST_INSTALL_PACKAGES`). "Keyinroq" deyilsa
   banner qoladi. Ilova oldinga chiqganda (15 daqiqadan keyin) qayta
   tekshiriladi — Android jarayonni fonda tirik saqlaydi. Profil → "Ilova
   versiyasi" build raqamini, "Yangilanishni tekshirish" esa natijani yoki
   xato sababini ko'rsatadi. Dev/Expo Go'da tekshiruv o'chiq (`__DEV__`).
   Build 3 va undan oldingi APK'larda tekshiruv yo'q — bir marta qo'lda o'rnatiladi.

## Ikonka

`assets/` dagi PNG'lar `scripts/make-icons.py` bilan yaratiladi (Pillow).
Belgi — ochiq kitob (ta'lim) + yashil "live" nuqta (jonli xabarlar); ranglar `brand` va `good` tokenlari. Ikonkani o'zgartirish
uchun skriptni tahrirlab qayta ishga tushiring, qo'lda PNG chizmang.
