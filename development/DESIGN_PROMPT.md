# EDULIVE — Design System & Master Prompt
### Maktab boshqaruv tizimi · Responsive Web + Android
**Versiya 1.0 · Stek: TypeScript · React · PostgreSQL**

---

## 0. Bu hujjat nima uchun

Bu hujjatda ikki narsa bor:

1. **MASTER PROMPT** (1-bo'lim) — AI dizayn/kod vositalariga (v0, Claude, Cursor, Figma Make) to'g'ridan-to'g'ri nusxalab qo'yiladigan tayyor prompt.
2. **Design system spetsifikatsiyasi** (2–9 bo'limlar) — dizayner va frontend dasturchi uchun aniq qoidalar: tokenlar, komponentlar, ekranlar, holatlar.

Prompt hujjatdan kelib chiqadi — ikkisi bir-biriga zid bo'lmasligi kerak. Biror narsa o'zgarsa, avval spetsifikatsiya, keyin prompt yangilanadi.

---

## 1. MASTER PROMPT (copy-paste)

> Quyidagi blokni butunligicha nusxalang. U ingliz tilida — AI vositalari ingliz tilida ancha barqaror ishlaydi. UI matnlari o'zbek tilida qoladi.

```
You are designing EDULIVE — a multi-tenant school management SaaS for private
schools in Uzbekistan. Stack: React + TypeScript, PostgreSQL backend.
All UI copy is in Uzbek (Latin script). Currency is so'm (UZS).

## PRODUCT CONTEXT

EduLive replaces the spreadsheets, paper journals and WhatsApp groups that private
schools use to run attendance, tuition payments and parent communication.
It is sold per-school as a subscription, so the same interface must feel correct
for a 120-student school and a 1,400-student school.

Four distinct user types, each with a different device and a different mood:

1. ADMINISTRATOR / DIRECTOR — desktop, 30-60 min sessions, wants money and
   risk at a glance: who owes, how much came in, who is absent again.
2. MANAGER — desktop, high-volume data entry: enroll students, take cash
   payments, fix attendance, print receipts. Speed and keyboard flow matter
   more than beauty.
3. TEACHER — Android phone, 40 seconds between lessons, one-handed, often on
   3G in a corridor. Takes attendance and enters a weekly 0-100 score.
   This is the highest-frequency, lowest-patience surface in the product.
4. PARENT — receives everything through a Telegram bot, never opens the web
   app. Bot messages are a first-class design surface, not an afterthought.

## DESIGN PRINCIPLES (in priority order)

1. MONEY IS THE PRODUCT. Payments, debt and collection are the reason a school
   pays for EduLive. Financial numbers get the largest type, the clearest
   hierarchy and the most careful state design. Never bury a debt figure in a
   table cell that looks like every other cell.
2. THE TEACHER FLOW MUST BE UNDER 40 SECONDS. Taking attendance for a class of
   30 = open class -> tap only the absent students -> confirm -> done. Default
   state is "present"; the teacher marks exceptions only. Never require
   scrolling through 30 rows and tapping each one.
3. DESTRUCTIVE AND FINANCIAL ACTIONS ARE ALWAYS CONFIRMED, AND ALWAYS LOGGED.
   Every payment, every attendance edit shows who did it and when. Surface the
   audit trail in the UI, not just the database.
4. DENSITY WITHOUT NOISE. Admin screens are data-dense tables. Achieve density
   with tight vertical rhythm and restrained ink — never with smaller-than-13px
   text, never with heavy borders on every cell.
5. DESIGNED FOR BAD NETWORKS. Every async surface has explicit loading,
   empty, error and offline states. Optimistic UI for attendance marking with
   a visible "saqlanmoqda / saqlandi" indicator.
6. ONE SYSTEM, TWO PLATFORMS. Web and Android share tokens, terminology, icons
   and information architecture. They do not share layout.

## VISUAL DIRECTION

Brand: EDULIVE. Confident, quiet, institutional-modern. Think a well-made banking
dashboard, not a colorful edtech toy. No illustrations of smiling children, no
gradients on brand surfaces, no rounded "bubbly" shapes.

- Primary brand color: INDIGO. Light mode #4F46E5, dark mode accent #818CF8.
- Brand color is reserved for: primary actions, active navigation, focus rings,
  and the logo. It is NOT a chart color and NOT a decorative background.
- Neutral surfaces are cool gray, not warm.
- Full light AND dark mode. Dark mode is separately chosen, never an
  auto-inverted light mode.
- Corner radius: 8px for controls, 12px for cards, 16px for sheets/modals.
- Shadows are barely there: a 1px hairline border does most of the work.
- Typeface: system UI sans stack. Tabular numerals for every column of numbers.
- Iconography: 20px stroke icons, 1.5px stroke, rounded caps. One family only.

## COLOR TOKENS

Light:  page #F6F7F9 · surface #FFFFFF · surface-2 #FAFBFC · border #E5E7EB
        text-1 #0F1115 · text-2 #4B5563 · text-3 #8B8F98
Dark:   page #0E1014 · surface #16181D · surface-2 #1C1F26 · border #262A33
        text-1 #F5F6F8 · text-2 #A8ADB8 · text-3 #6F757F
Status (both modes, never re-themed, always shipped with an icon + label):
        good #0CA30C · warning #FAB219 · serious #EC835A · critical #D03B3B
Chart series (validated for colorblind separation — do not substitute):
        light: #2A78D6, #EB6834, #1BAF7A
        dark:  #3987E5, #D95926, #199E70

## DATA VISUALIZATION RULES

- Never a dual-axis chart. Never a pie chart with more than 3 slices.
- Single-series trend = one blue line, 2px, no legend (the title names it).
- Payment status breakdown = horizontal stacked bar using the STATUS palette
  (to'langan = good, qisman = warning, qarzdor = critical), with direct labels
  and a 2px surface gap between segments.
- Class-by-class comparison = horizontal bars in one hue, sorted by value.
- Headline numbers are stat tiles (value + delta + optional sparkline),
  never a one-bar bar chart.
- Every chart has a hover tooltip and an accessible table equivalent.

## SCREENS TO DESIGN

WEB (responsive, 1440 / 1024 / 768 / 390):
  A. Dashboard — KPI row (attendance %, absent count, today's revenue, total
     debt), 14-day attendance trend line, payment status by grade (stacked),
     monthly collection meter, notification feed, absent-students list.
  B. O'quvchilar — dense filterable table: name, class, parent, phone, payment
     status chip, attendance %, actions. Bulk select. Excel import/export.
  C. O'quvchi kartasi — header with photo/initials + key facts, tabs:
     Asosiy · Ota-ona · To'lovlar · Davomat · Baholar. Payment tab shows a
     ledger with running balance and a prominent "To'lov qabul qilish" action.
  D. To'lovlar — payment intake form (amount, method: naqd/click/payme, month,
     note) with live remaining-balance preview + today's payment log.
  E. Qarzdorlar — sorted by risk: months overdue, amount, last contact,
     one-tap "Telegram orqali eslatma yuborish".
  F. Davomat — grid of classes x today's status, admin override with reason.
  G. Super-admin (tenant panel) — schools list, plan, student count, MRR,
     status, last activity.

ANDROID (390x844, one-handed, thumb zone):
  H. Teacher home — today's lessons/classes, attendance-pending badges.
  I. Attendance — student list, default present, tap to mark absent/late,
     sticky summary bar, single confirm button in the thumb zone.
  J. Confirmation sheet — jami / kelgan / kelmagan / kech qolgan, then commit.
  K. Weekly grading — per-student 0-100 with a large stepper/slider, swipe to
     next student, progress indicator.

TELEGRAM BOT (parent surface):
  L. Message templates: daily attendance notice, absence alert, late alert,
     payment receipt, debt reminder, school announcement, "sabab yuborish"
     reply flow. Design as actual chat bubbles with inline keyboards.

## STATES — REQUIRED FOR EVERY SCREEN

loading (skeleton, never a spinner on a full page) · empty (explains what to do
next, with the primary action) · error (what failed + retry) · offline banner ·
no-permission (role-aware, explains who to ask) · saving / saved indicator.

## ACCESSIBILITY & LOCALIZATION

- WCAG AA: 4.5:1 body text, 3:1 UI and chart marks.
- Never color alone: status chips always carry an icon and a word.
- Full keyboard operation on web; visible 2px indigo focus ring.
- Touch targets >= 44x44 on Android.
- Copy in Uzbek Latin; the layout must tolerate +30% string growth for a
  future Russian translation. No text baked into images.
- Numbers formatted 18 400 000 so'm (space as thousands separator).
- Dates: 09.08.2026. Week starts Monday.

## DELIVERABLE

A single self-contained responsive HTML file per platform, with a working
light/dark toggle and a screen switcher, using inline SVG for charts and icons.
No external assets. Realistic Uzbek sample data — real-sounding names, real
class names (5-A, 9-B), realistic so'm amounts.
```

---

## 2. Design tokens

### 2.1 Rang

| Rol | Light | Dark | Izoh |
|---|---|---|---|
| `--page` | `#F6F7F9` | `#0E1014` | Sahifa foni |
| `--surface` | `#FFFFFF` | `#16181D` | Karta, jadval, modal |
| `--surface-2` | `#FAFBFC` | `#1C1F26` | Jadval sarlavhasi, ichki blok |
| `--border` | `#E5E7EB` | `#262A33` | 1px hairline |
| `--text-1` | `#0F1115` | `#F5F6F8` | Asosiy matn, raqamlar |
| `--text-2` | `#4B5563` | `#A8ADB8` | Ikkilamchi matn |
| `--text-3` | `#8B8F98` | `#6F757F` | Yorliq, placeholder |
| `--brand` | `#4F46E5` | `#4F46E5` | Asosiy amal |
| `--brand-hover` | `#4338CA` | `#6366F1` | |
| `--brand-soft` | `#EEF2FF` | `#1E1B4B` | Faol nav foni |
| `--brand-ink` | `#4F46E5` | `#818CF8` | Brend rangli matn |

**Status (ikkala rejimda bir xil, hech qachon o'zgartirilmaydi):**

| Rol | Hex | Qayerda |
|---|---|---|
| good | `#0CA30C` | To'langan, keldi, faol |
| warning | `#FAB219` | Qisman to'langan, kech qoldi |
| serious | `#EC835A` | 1 oy qarz, sababsiz |
| critical | `#D03B3B` | 2+ oy qarz, kelmadi |

> **Qoida:** status rangi hech qachon yolg'iz ma'no tashimaydi. Har doim **belgi (ikonka) + so'z** bilan birga keladi. Light rejimda `warning` va `serious` foni bilan kontrasti 3:1 dan past — shuning uchun matn yorlig'i majburiy.

**Diagramma ranglari (tekshirilgan — almashtirmang):**

| Slot | Light | Dark |
|---|---|---|
| 1 | `#2A78D6` | `#3987E5` |
| 2 | `#EB6834` | `#D95926` |
| 3 | `#1BAF7A` | `#199E70` |

Bu uchlik ranglarni ajrata olmaydigan foydalanuvchilar uchun ham tekshirilgan (CVD ΔE 9.2 light / 9.4 dark). To'rtinchi seriya kerak bo'lsa — rang qo'shmang, "Boshqa"ga yig'ing yoki diagrammani bo'ling.

### 2.2 Tipografika

Shrift: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`

| Token | O'lcham / qalinlik | Qayerda |
|---|---|---|
| `display` | 40 / 600, -0.02em | Hero raqam (dashboard) |
| `h1` | 24 / 600 | Sahifa sarlavhasi |
| `h2` | 18 / 600 | Karta sarlavhasi |
| `body` | 14 / 400 | Asosiy matn, jadval |
| `body-strong` | 14 / 600 | Jadvaldagi ism, summa |
| `label` | 13 / 500 | Forma yorliqlari |
| `caption` | 12 / 500, +0.01em | Yordamchi matn, chip |
| `mono-num` | 14 / 600, `tabular-nums` | **Barcha pul ustunlari** |

> Raqamlar ustuni **har doim** `font-variant-numeric: tabular-nums` bilan — aks holda summalar ustunda qalqib turadi.

### 2.3 Bo'shliq, radius, soya

- **Spacing shkalasi:** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48
- **Radius:** control `8px` · card `12px` · sheet/modal `16px` · chip `999px`
- **Soya:** `0 1px 2px rgba(15,17,21,.04)` — undan kuchliroq soya yo'q. Ajratishni 1px hairline qiladi.
- **Fokus rings:** `0 0 0 2px var(--surface), 0 0 0 4px var(--brand)`
- **Animatsiya:** 150ms `cubic-bezier(.2,0,0,1)`. Faqat opacity va transform. `prefers-reduced-motion` hurmat qilinadi.

---

## 3. Komponentlar

| Komponent | Spetsifikatsiya |
|---|---|
| **Button** | H36 (sm) / H40 (md) / H44 (lg, mobil). Variantlar: primary (indigo fon), secondary (hairline), ghost, danger. Yuklanish holatida matn qoladi + spinner chapda. |
| **Input** | H40, 1px border, fokusda indigo ring. Xato holati: critical border + ostida 12px xato matni. Pul kiritishda avtomatik `1 200 000` formatlash. |
| **Status chip** | H24, pill, 12/500, **ikonka + matn**, 8px ichki bo'shliq. Fon = status rangi 12% alpha, matn = status rangi to'q varianti. |
| **Table** | Sarlavha `surface-2`, 13/600, sticky. Qator balandligi 52px. Hover: `surface-2`. Tanlangan: `brand-soft`. Zebra chiziq **yo'q**. Faqat gorizontal ajratgichlar. |
| **Stat tile** | Yorliq (12/500 `text-3`) → qiymat (32/600) → delta (13/500, ikonka + %) → ixtiyoriy sparkline. |
| **Modal** | Max 560px, 16px radius, sarlavha + matn + o'ng tomonda amallar. Moliyaviy tasdiq modallari summani **katta shriftda takrorlaydi**. |
| **Sheet (mobil)** | Pastdan chiqadi, 16px yuqori radius, drag handle, tugmalar bosh barmoq zonasida. |
| **Toast** | Pastda chapda (web) / yuqorida (mobil), 4s, amalni bekor qilish tugmasi bilan. |
| **Empty state** | Ikonka (32px, `text-3`) + sarlavha + bir jumla tushuntirish + asosiy amal tugmasi. |
| **Skeleton** | To'liq sahifa spinneri **hech qachon**. Jadval uchun 5 qator skeleton, karta uchun blok skeleton. |

---

## 4. Ekran spetsifikatsiyalari

### 4.1 Dashboard (Administrator)

```
[ KPI qatori — 4 ta stat tile ]
  Bugungi davomat %    Kelmaganlar    Bugungi tushum    Umumiy qarzdorlik
[ 2/3 ] Davomat trendi (14 kun, chiziq)   [ 1/3 ] Oylik yig'im (meter)
[ 2/3 ] Sinflar bo'yicha to'lov holati    [ 1/3 ] Bildirishnomalar
[ Bugun kelmaganlar — jadval, ota-onaga xabar tugmasi bilan ]
```

Qoidalar:
- Qarzdorlik summasi **critical** rangda emas — u neytral, lekin eng katta shriftda. Rang faqat trend yomonlashsa qo'shiladi.
- Har bir KPI bosilsa tegishli to'liq sahifaga o'tadi.
- Trend diagrammasi bitta seriya → legenda yo'q, sarlavha nomlaydi.

### 4.2 O'quvchilar

Ustunlar: `☐ · F.I.Sh · Sinf · Ota-ona · Telefon · To'lov holati · Davomat % · ⋯`

- Yuqorida filtr qatori: sinf, to'lov holati, davomat oralig'i, qidiruv.
- Ko'p tanlash → ommaviy amallar paneli pastdan chiqadi (sinf o'zgartirish, arxivlash, xabar yuborish).
- O'ng yuqorida: **Excel import** va **Eksport**. Import — 3 bosqichli sehrgar (fayl → ustunlarni moslashtirish → oldindan ko'rish va xatolar).
- Bo'sh holat: "Hali o'quvchi qo'shilmagan" + ikkita tugma: qo'lda qo'shish, Excel'dan import.

### 4.3 O'quvchi kartasi

- Sarlavha: initsiallar avatari, F.I.Sh, sinf chipi, to'lov status chipi, o'ng tomonda `To'lov qabul qilish` (primary).
- Tablar: **Asosiy · Ota-ona · To'lovlar · Davomat · Baholar**
- To'lovlar tabi = **ledger**: sana, tur, summa, qoldiq (running balance), qabul qilgan xodim. Har qatorda audit ma'lumoti.
- Davomat tabi = oylik kalendar issiqlik xaritasi + sabablar ro'yxati.

### 4.4 To'lov qabul qilish

- Chapda forma: o'quvchi (avtoto'ldirish), oy (multi-select — bir necha oyni bir vaqtda yopish), summa, usul (naqd / Click / Payme), izoh.
- O'ngda **jonli hisob-kitob**: joriy qarz → to'lov → yangi qoldiq. Raqamlar 24/600.
- Tasdiq modalida summa yana **32/600 shriftda takrorlanadi** — bu eng ko'p xato bo'ladigan joy.
- Saqlangandan keyin: chek chop etish + Telegram orqali ota-onaga yuborish.

### 4.5 Qarzdorlar

Xavf bo'yicha saralangan. Ustunlar: `F.I.Sh · Sinf · Qarz summasi · Necha oy · Oxirgi aloqa · Amal`

- "Necha oy" ustuni status rangida: 1 oy = warning, 2 oy = serious, 3+ = critical. Har birida ikonka + so'z.
- Har qatorda `Eslatma yuborish` tugmasi → Telegram shabloni oldindan ko'rish bilan.
- Ommaviy: tanlanganlarning hammasiga bir marta eslatma.

### 4.6 Super-admin (tenant paneli)

Ustunlar: `Maktab · Tarif · O'quvchilar · Oylik to'lov · Holat · Oxirgi faollik`

- Yuqorida: jami maktablar, jami o'quvchilar, MRR, faol bo'lmagan maktablar soni.
- Har maktabga kirish tugmasi (impersonate) — **audit logga yoziladi va bannerda ko'rinadi**.

### 4.7 O'qituvchi — davomat (Android)

Bu mahsulotdagi eng muhim ekran.

```
[ Sarlavha: 7-A sinf · 09.08.2026 · 28 o'quvchi ]
[ Yopishqoq xulosa: Kelgan 26 · Kelmagan 2 · Kech 0 ]
[ O'quvchilar ro'yxati — hammasi sukut bo'yicha "Keldi" ]
   Har qator: avatar · ism · [Keldi ✓] segment tugma
   Bosilganda: Keldi → Kelmadi → Kech qoldi → Keldi (aylanma)
[ Bosh barmoq zonasi: TASDIQLASH (to'liq kenglik, H52) ]
```

Qoidalar:
- Hech qanday scroll majburiy emas — o'qituvchi faqat kelmaganlarni bosadi.
- Tasdiqlash sheet'i: jami / kelgan / kelmagan / kech qolgan + "Bu ota-onalarga xabar yuboradi" ogohlantirishi.
- Tasdiqlangandan keyin: muvaffaqiyat ekrani + "3 soat ichida tahrirlash mumkin" taymeri.
- Oflayn: navbatga qo'yiladi, "Internet qaytganda yuboriladi" banneri.

### 4.8 O'qituvchi — haftalik baho (Android)

- Bitta o'quvchi = bitta ekran. Katta 0–100 slider + tez tanlash tugmalari (60/70/80/90/100).
- Pastda progress: "12 / 28 o'quvchi".
- Chapga surish = keyingi o'quvchi.
- Chiqishda avtomatik qoralama saqlanadi.

### 4.9 Telegram bot (ota-ona)

Xabar shablonlari — har biri qisqa, birinchi qatorda eng muhim ma'lumot:

| Vaziyat | Shablon |
|---|---|
| Davomat | `✅ Aziza bugun darsga keldi. 09.08, 08:15` |
| Kelmadi | `❌ Aziza bugun darsga kelmadi. 09.08\n\nSabab yuborish uchun tugmani bosing.` + inline tugma |
| Kech qoldi | `🟡 Aziza darsga 18 daqiqa kechikdi. 09.08, 08:33` |
| To'lov | `💳 To'lov qabul qilindi\nSumma: 1 200 000 so'm\nOy: Avgust 2026\nQoldiq: 0 so'm` |
| Qarzdorlik | `📌 Avgust oyi uchun 1 200 000 so'm to'lov kutilmoqda.\nMuddat: 10.08.2026` |

Inline klaviatura: `Sabab yuborish` · `To'lov qilish` · `Davomat tarixi` · `Baholar`

> Bir ota-onada bir necha farzand bo'lsa — har xabar boshida farzand ismi. Bog'lanish telefon raqamini tasdiqlash orqali, `/start <school_hash>` deep link bilan.

---

## 5. Responsive qoidalari

| Breakpoint | Layout |
|---|---|
| `≥1280px` | Sidebar ochiq (240px) + kontent. Dashboard 3 ustun. Jadval to'liq. |
| `1024–1279px` | Sidebar ikonka rejimi (64px). Dashboard 2 ustun. |
| `768–1023px` | Sidebar yashiringan (drawer). Dashboard 2 ustun, KPI 2×2. |
| `<768px` | Pastda tab bar (5 ta asosiy bo'lim). KPI 1 ustun. **Jadvallar kartaga aylanadi** — gorizontal scroll qilinadigan jadval emas. |

Mobil web'da jadvalni gorizontal scroll qilishga majburlamang — har qator kartaga aylanadi: ism + sinf yuqorida, qolgan maydonlar yorliq–qiymat juftligi sifatida.

---

## 6. Android ilova qoidalari

- **Faqat o'qituvchi uchun** (1-bosqichda). Administrator web'da ishlaydi.
- Material 3 asos, lekin EduLive tokenlari bilan (indigo, bir xil radius, bir xil status ranglari).
- Pastda navigatsiya: `Bugun · Sinflar · Baholar · Profil`
- Barcha asosiy amallar bosh barmoq zonasida (ekranning pastki 1/3).
- Teginish nishoni ≥ 44×44dp.
- Oflayn-first: davomat lokal saqlanadi, internet qaytganda sinxronlanadi.
- Push bildirishnoma: "7-A sinfda davomat olinmagan" (11:00 da).
- Orqaga tugmasi tasdiqlanmagan davomatni yo'qotmaydi — qoralama saqlanadi.

---

## 7. Holatlar (har bir ekran uchun majburiy)

| Holat | Talab |
|---|---|
| Loading | Skeleton. To'liq sahifa spinneri taqiqlanadi. |
| Empty | Ikonka + sarlavha + bir jumla + asosiy amal. "Ma'lumot yo'q" degan quruq matn taqiqlanadi. |
| Error | Nima ishlamadi + qayta urinish tugmasi + qo'llab-quvvatlash havolasi. |
| Offline | Yuqorida doimiy banner + navbatdagi amallar soni. |
| No permission | Rol nomi bilan tushuntirish: "Bu bo'lim faqat administrator uchun." |
| Saving | Inline "Saqlanmoqda…" → "Saqlandi ✓" (2s). Bloklovchi modal emas. |

---

## 8. Kirish imkoniyati (Accessibility)

- WCAG AA: matn 4.5:1, UI elementlari va diagramma belgilari 3:1.
- **Rang hech qachon yolg'iz ma'no tashimaydi** — status har doim ikonka + so'z bilan.
- Web'da to'liq klaviatura boshqaruvi; ko'rinadigan 2px indigo fokus halqasi.
- Har diagrammaning jadval ekvivalenti mavjud (`Jadval ko'rinishi` tugmasi).
- `prefers-reduced-motion` va `prefers-color-scheme` hurmat qilinadi.
- Mobil teginish nishoni ≥ 44×44.

---

## 9. Til va formatlash

- UI tili: **o'zbek (lotin)**. Layout matn +30% o'sishiga chidashi kerak (kelajakdagi rus tili uchun).
- Rasmga matn "pishirib" qo'yilmaydi.
- Pul: `1 200 000 so'm` (bo'shliq ajratgich, valyuta oxirida).
- Sana: `09.08.2026`. Vaqt: `08:15`. Hafta dushanbadan boshlanadi.
- Ismlar: `Familiya Ism` tartibida jadvalda, `Ism Familiya` xabarlarda.

---

## 10. Har ekran uchun qisqa promptlar

Master promptdan keyin bitta ekranni qayta ishlash kerak bo'lsa, quyidagi shablon:

```
Using the EDULIVE design system (indigo #4F46E5 brand, cool gray neutrals,
system-ui sans, tabular numerals for money, status colors
good #0CA30C / warning #FAB219 / serious #EC835A / critical #D03B3B always
with icon + label, 12px card radius, 1px hairline borders, near-zero shadows,
full light + dark mode), design the <EKRAN NOMI> screen.

Users: <ROL>. Device: <desktop 1440 / Android 390x844>.
Job to be done: <BIR JUMLA>.
Must include states: loading (skeleton), empty, error, offline.
Copy in Uzbek Latin. Currency so'm formatted 1 200 000 so'm.
Output: a self-contained responsive HTML file with inline SVG, no external assets.
```

---

*EduLive Design System v1.0 — 09.08.2026*
