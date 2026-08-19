# CLAUDE.md — EduLive

Maktab boshqaruv tizimi, nodavlat maktablar uchun **multi-tenant SaaS**.
(Brend: **EduLive**; papka nomi tarixiy sabab bilan `schoola`.)
Bitta o'rnatma — ko'p maktab. Foydalanuvchi tili: **o'zbek (lotin)**.

---

## Buzilmasligi kerak bo'lgan 6 qoida

1. **Har bir so'rovda `school_id` filtri.**
   `resolveTenant` middleware `req.schoolId` ni to'ldiradi. Undan keyin
   `school_id` siz `SELECT`/`UPDATE`/`DELETE` yozilmaydi — hech qachon, hech
   qanday istisno bilan. Bitta maktab boshqasining ma'lumotini ko'rsa, mahsulot
   tugadi. Yangi endpoint yozganda birinchi navbatda shu filtrni qo'ying.

2. **Pul va davomat o'zgarishi `audit()` orqali yoziladi.**
   `src/modules/audit/audit.service.ts`. Tranzaksiya ichida bo'lsa o'sha
   `client` ni uzating: `await audit(req, {...}, client)`.
   `audit_log` faqat qo'shiladi — hech qachon `UPDATE`/`DELETE` qilinmaydi.

3. **Sozlamalar bazada, kodda emas.**
   To'lov muddati kuni, baho tizimi, sinf tuzilishi, ish vaqti — hammasi
   `schools.settings` (jsonb) da. Kodda `if (day === 10)` kabi narsa bo'lmaydi.

4. **To'lovda `idempotency_key` majburiy.**
   Click/Payme webhook'i bitta to'lovni ikki marta yuborishi — normal holat,
   xato emas. `payments_idempotent` unique indeksi buni ushlaydi; kod
   `ON CONFLICT DO NOTHING` bilan tinch o'tishi kerak.

5. **Davomatda sukut holati `present`.**
   O'qituvchi faqat kelmaganlarni belgilaydi. API kelmaganlar ro'yxatini qabul
   qiladi, qolgani avtomatik `present`. 30 ta yozuv jo'natishni talab qilmang.

6. **Migratsiya qo'llangandan keyin tahrirlanmaydi.**
   Yangi `.sql` fayl yozing: `002_...`, `003_...`. Raqamlar ketma-ket.

---

## Struktura

```
backend/    Express + TypeScript + PostgreSQL (raw SQL, ORM yo'q)
fronted/    React + TypeScript + Vite   (papka nomi ataylab shunday — kassly bilan bir xil)
android/    React Native + Expo — faqat o'qituvchi ilovasi
development/ maketlar, DESIGN_PROMPT.md, DECISIONS.md, requirements.md
deploy/     production .env namunasi va DEPLOY.md
```

Ish boshlashdan oldin o'qing: `development/DECISIONS.md` (nega shunday) va
`development/requirements.md` (nima qilinadi va qaysi bosqichda).

---

## Backend konvensiyalari

**Modul shabloni** — `src/modules/<nom>/`:

```
<nom>.routes.ts     Express Router; validatsiya + so'rov/javob
<nom>.service.ts    biznes mantiq va SQL (murakkab bo'lsa)
```

Router `src/routes.ts` da ro'yxatdan o'tadi. Qoidalar:

- ORM yo'q — `pool.query` va parametrlangan SQL (`$1, $2`). String konkatenatsiya
  bilan SQL yozish taqiqlanadi.
- Bir nechta yozuvni o'zgartiruvchi amal — `tx()` ichida (`src/db/pool.ts`).
- Kirish ma'lumotlari `zod` bilan tekshiriladi.
- Xatolar `utils/errors.ts` dan: `badRequest`, `forbidden`, `notFound`, `conflict`.
  Xato matnlari **o'zbek tilida** — ular foydalanuvchiga ko'rinadi.
- `async` handler'lar `ah()` bilan o'raladi (`utils/http.ts`).
- Pul — `numeric(14,2)`. `pool.ts` uni `number` qilib o'qiydi. Float bilan
  hisob-kitob qilmang, summani so'm butun sonida saqlang.

**Rollar:** `superadmin` (platforma) · `admin` · `manager` · `teacher`.
`requireRole('admin','manager')` — `superadmin` har doim o'tadi.
O'qituvchi faqat `class_subject_teachers` va `classes.homeroom_teacher_id`
orqali biriktirilgan sinflarini ko'radi.

**Buyruqlar:**

```bash
cd backend
docker compose up -d     # Postgres :5434
npm run dev              # :4000
npm run migrate          # kutilayotgan .sql larni qo'llaydi
npm run db:reset         # sxemani tashlab qayta quradi + seed
npm test                 # tsx --test, ketma-ket
npm run typecheck
```

---

## Frontend konvensiyalari

- Rang/o'lcham **faqat** `src/styles/tokens.css` dagi CSS o'zgaruvchilari orqali.
  Komponentda hex yozilmaydi.
- Pul va raqam ustunlari — `className="num"` (`tabular-nums`).
  Format: `money()` va `date()` — `src/lib/api.ts`.
- Status rangi **hech qachon yolg'iz ma'no tashimaydi**: ikonka + so'z birga.
- Har bir ekranda 4 holat majburiy: loading (skeleton, to'liq sahifa spinneri
  emas), empty (nima qilish kerakligini aytadi), error (qayta urinish tugmasi),
  offline.
- 640px dan pastda jadval kartaga aylanadi — gorizontal scroll YO'Q.
- Ma'lumot olish — TanStack Query; `api` instansiyasi tokenni o'zi qo'shadi.

Tayyor maketlar (brauzerda oching, to'liq ishlaydi):
`development/web-ui.dc.html`, `development/mobile-ui.dc.html`.
Spetsifikatsiya: `development/DESIGN_PROMPT.md`.

---

## Android konvensiyalari

- Tokenlar `src/theme.ts` — web'dagi `tokens.css` bilan **bir xil qiymatlar**.
- Teginish nishoni ≥ 44dp (`HIT`).
- Asosiy amal doim bosh barmoq zonasida (pastki 1/3).
- **Oflayn-first**: davomat lokal saqlanadi, aloqa tiklanganda yuboriladi.
  Ota-onaga xabar faqat server tasdiqlagandan keyin ketadi.

---

## Ma'lumotlar bazasi — asosiy jadvallar

`schools` · `academic_years` · `users` · `students` · `enrollments` ·
`parents` + `student_parents` (N:N) · `classes` · `subjects` ·
`class_subject_teachers` · `lessons` · `attendance_sessions` · `attendance` ·
`grading_schemes` · `grades` · `invoices` · `payments` + `payment_allocations` ·
`expenses` · `notifications` · `audit_log`

Kelajakka moslangan joylar (migratsiya kerak bo'lmasligi uchun):

- `attendance.lesson_id` **NULL bo'lishi mumkin** → NULL = kunlik davomat.
  Dars bo'yicha davomatga o'tilganda shunchaki to'ldiriladi.
- `attendance.source` = `manual | auto | device` → avtomatik davomat uchun tayyor.
- `grading_schemes.criteria` (jsonb) → 100 ballni mezonlarga bo'lish sozlama, kod emas.
- `payments.provider` = `cash | click | payme | transfer | manual` → hozir qo'lda,
  keyin API.

---

## Ehtiyot bo'lish kerak bo'lgan joylar

- **Kundalik.com.** Ochiq API yo'q. Hozircha faqat **Excel/CSV eksport** qilinadi.
  Scraping yoki o'qituvchi parolidan foydalanish **taqiqlanadi** — foydalanuvchi
  shartnomasi buziladi, sotiladigan mahsulot uchun huquqiy xavf.
- **Biometrika.** Yuz orqali davomat qo'shilsa, u biometrik ma'lumot bo'ladi va
  qonun bo'yicha O'zbekistondagi serverda saqlanishi shart. RFID/QR bilan boshlang.
- **Telegram.** Bitta bot, ko'p maktab. Maktab `/start <tg_code>` deep link orqali
  aniqlanadi. Ota-ona telefon raqamini tasdiqlaydi; bitta ota-onada bir nechta
  farzand bo'lishi mumkin — har xabar boshida farzand ismi.

---

## Uslub

- Izohlar va foydalanuvchiga ko'rinadigan matnlar — o'zbek tilida.
  O'zgaruvchi va funksiya nomlari — ingliz tilida.
- Izoh **nega** shunday qilinganini yozadi, **nima** qilinayotganini emas.
- Kerak bo'lmagan abstraksiya qo'shmang. Kassly'da ishlagan yondashuv shu yerda
  ham ishlaydi — yangi naqsh o'ylab topishdan oldin `kassly/backend/src` ga qarang.
