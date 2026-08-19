# EduLive — backend

Express + TypeScript + PostgreSQL. Multi-tenant: **bitta baza, `school_id`
bo'yicha ajratish**.

## Ishga tushirish

```bash
cp .env.example .env          # JWT_SECRET ni o'zgartiring
docker compose up -d          # Postgres :5434
npm install
npm run migrate               # sxemani yaratadi
npm run dev                   # http://localhost:4000
```

## Struktura

```
src/
  config/env.ts            barcha muhit o'zgaruvchilari bir joyda
  db/pool.ts               pg pool + tx() yordamchisi
  db/migrate.ts            oldinga yo'naltirilgan migratsiya
  db/migrations/*.sql      raqamlangan, o'zgartirilmaydigan
  middleware/auth.ts       JWT + rol
  middleware/tenant.ts     school_id ni aniqlaydi  ← XAVFSIZLIK MARKAZI
  middleware/error.ts      yagona xato formati
  modules/<nom>/           <nom>.routes.ts + <nom>.service.ts
  utils/                   errors, http, validation
```

## Buzilmasligi kerak bo'lgan qoidalar

1. **Har bir so'rovda `req.schoolId` filtri.** Filtrsiz `SELECT` yozmang.
   Bitta maktab boshqasining ma'lumotini ko'rsa, mahsulot tugadi.
2. **Pul va davomat o'zgarishi `audit()` orqali yoziladi.** Istisno yo'q.
3. **Sozlamalar `schools.settings` da**, kodda hardcode qilinmaydi
   (to'lov muddati, baho tizimi, sinf tuzilishi).
4. **To'lovda `idempotency_key`** — Click/Payme webhook'i ikki marta kelishi normal.
5. Migratsiya fayli qo'llangandan keyin **tahrirlanmaydi** — yangisini yozing.

## Testlar

```bash
npm test          # tsx --test, ketma-ket (baza umumiy)
```
