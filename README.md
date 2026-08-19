# EduLive

Maktab boshqaruv tizimi — nodavlat maktablar uchun SaaS.
(Papka nomi tarixiy sabab bilan `schoola`.)
Davomat, to'lovlar, qarzdorlik, baholar va ota-onalar bilan Telegram aloqasi.

**Multi-tenant**: bitta o'rnatma, ko'p maktab. Har jadvalda `school_id`.

## Struktura

```
schoola/
├── backend/       Express + TypeScript + PostgreSQL (REST API)
├── fronted/       React + TypeScript + Vite (admin va menejer paneli)
├── android/       React Native + Expo (o'qituvchi ilovasi)
├── development/   dizayn maketlari, spetsifikatsiya, qarorlar jurnali
├── deploy/        production .env namunasi va deploy qo'llanmasi
└── docker-compose.prod.yml
```

## Tez boshlash

```bash
# 1. Ma'lumotlar bazasi
cd backend && cp .env.example .env && docker compose up -d

# 2. Backend
npm install && npm run migrate && npm run dev      # :4000

# 3. Web
cd ../fronted && npm install && npm run dev        # :5173

# 4. Mobil (ixtiyoriy)
cd ../android && npm install && npx expo start
```

Git hali initsializatsiya qilinmagan:

```bash
git init && git add . && git commit -m "chore: initial scaffold"
```

## Dizayn

Maketlarni brauzerda oching — ikkalasi ham to'liq ishlaydi:

- `development/web-ui.dc.html` — 7 ta admin ekrani, light/dark, interaktiv diagrammalar
- `development/mobile-ui.dc.html` — 9 ta mobil ekran + Telegram bot oqimi
- `development/DESIGN_PROMPT.md` — design system va AI vositalari uchun tayyor prompt

## Buzilmasligi kerak bo'lgan 5 qoida

1. **Har bir so'rovda `school_id` filtri.** Filtrsiz `SELECT` yozilmaydi.
2. **Pul va davomat o'zgarishi audit logga yoziladi.** Istisno yo'q.
3. **Sozlamalar bazada** (`schools.settings`), kodda hardcode qilinmaydi.
4. **To'lovda `idempotency_key`** — webhook ikki marta kelishi normal holat.
5. **Davomatda sukut holati "Keldi"** — o'qituvchi faqat kelmaganlarni bosadi.

Batafsil: `development/DECISIONS.md`
