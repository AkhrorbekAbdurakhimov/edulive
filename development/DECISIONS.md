# Qarorlar jurnali

> Bu fayl "nega shunday qilingan" savoliga javob beradi. Yangi qaror qabul
> qilinganda shu yerga qo'shiladi — kodda tushuntirish yozilmaydi.

## Arxitektura (buzilmaydi)

| # | Qaror | Sabab |
|---|---|---|
| A1 | Multi-tenant: bitta baza, har jadvalda `school_id` | Mahsulot ko'p maktabga sotiladi. Keyin ko'chirish = qayta yozish. |
| A2 | Hamma narsa `academic_year_id` ga bog'lanadi | O'quv yili birinchi darajali obyekt; keyin qo'shib bo'lmaydi. |
| A3 | Bitta Telegram bot, ko'p maktab (`/start <tg_code>`) | Har maktabga alohida bot = boshqarish do'zaxi. |
| A4 | Bitta notification engine, kanal — parametr | 9 va 12-modullar aslida bitta tizim. |
| A5 | Sozlamalar `schools.settings` (jsonb) da | Har maktabda sinf tuzilishi, to'lov muddati, baho tizimi boshqacha. |
| A6 | `audit_log` — faqat qo'shiladi, hech qachon o'chirilmaydi | Pul bilan ishlaydigan tizimda majburiy. |

## 12 nuqta bo'yicha qarorlar (09.08.2026)

| # | Savol | Qaror | Bazadagi aksi |
|---|---|---|---|
| 1 | Davomatni kim/qachon oladi | Hozir kuniga 1 marta. Keyin dars bo'yicha, undan keyin avtomatik. | `attendance.lesson_id` NULL bo'lishi mumkin, `source` ustuni bor |
| 2 | Baho tizimi | 100 ball, haftalik. Keyin o'zgarishi mumkin. | `grading_schemes` sozlama jadvali (`criteria` hozir bo'sh) |
| 3 | Kundalik.com | **Hozircha faqat eksport** (Excel/CSV). Rasmiy API bo'lsa keyin ulanadi. | alohida modul, tashqi bog'liqliksiz |
| 4 | Audit | Qo'shildi | `audit_log` |
| 5 | To'lov | Hozir qo'lda tasdiqlash, keyin Click/Payme API | `payments.provider`, `external_id`, `status`, `idempotency_key` |
| 6 | Bildirishnomalar | Yagona engine | `notifications` (channel: telegram/sms/inapp) |
| 7 | Ota-onani identifikatsiya | Telefon tasdiqlash, 1 ota-ona = N farzand | `parents`, `student_parents` (N:N) |
| 8 | O'quv yili | Barcha jadvallarga kalit | `academic_years` |
| 9 | Xodimlar va maosh | Qo'shildi | `expenses.staff_id`, `salary_month` |
| 10 | Excel import/eksport | Qo'shildi | alohida modul (`exceljs`) |
| 11 | Hujjat generatsiyasi | Qo'shildi | `pdfkit` — shartnoma, kvitansiya, ma'lumotnoma |
| 12 | Multi-tenant / filial | Birinchi kundan | A1 ga qarang |

## Ochiq masalalar

- **Kundalik.com API.** Ochiq hujjatlashtirilgan API topilmadi. Rasmiy yozishma
  boshlash kerak. Scraping yoki o'qituvchi paroli — **taqiqlanadi** (foydalanuvchi
  shartnomasi buzilishi, sotiladigan mahsulot uchun huquqiy xavf).
- **Avtomatik davomat.** Yuz orqali bo'lsa — biometrik ma'lumot, O'zbekistonda
  saqlanishi shart. **RFID/QR karta bilan boshlash tavsiya etiladi** (biometrika emas,
  10 barobar arzon).
- ~~**Brend nomi.**~~ **Hal qilindi (10.08.2026): EduLive.** UI, hujjatlar va
  identifikatorlar EduLive'ga o'tkazildi. Papka nomi (`schoola`) va lokal dev
  bazasi nomlari eskicha qoldi — ular foydalanuvchiga ko'rinmaydi, keyin xohlasa
  alohida o'zgartiriladi. Tovar belgisi 42-sinfda ro'yxatdan o'tkaziladi;
  dastur DGU guvohnomasi bilan qayd etiladi.
