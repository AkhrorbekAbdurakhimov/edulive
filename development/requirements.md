# EduLive — modullar va bosqichlar

21 modul. Batafsil ekran spetsifikatsiyasi: `DESIGN_PROMPT.md`.
Nega shunday qilingani: `DECISIONS.md`.

## 1-bosqich — MVP (2–3 oy) · shu holida ham maktab pul to'laydi

| Modul | Mazmun |
|---|---|
| Foydalanuvchilar va rollar | superadmin / admin / menejer / o'qituvchi, JWT, token_version |
| Maktablar (tenant) | maktab, o'quv yili, sozlamalar |
| O'quvchilar | ro'yxat, karta, arxiv, Excel import |
| Sinflar | 1–11, sinf rahbari, o'quvchilar |
| Davomat | kuniga 1 marta, sukut "Keldi", tasdiqlash, 3 soatlik tahrir oynasi |
| To'lovlar | oylik hisob, qisman/oldindan to'lov, chegirma, kvitansiya |
| Qarzdorlar | avtomatik shakllanadi, eslatma yuborish |
| Telegram bot | davomat, to'lov, qarzdorlik, sabab yuborish |
| Audit log | har bir moliyaviy va davomat o'zgarishi |
| Dashboard | KPI, davomat trendi, to'lov holati, bildirishnomalar |

## 2-bosqich

Fanlar · Dars jadvali · Baholar (haftalik 100 ball) · Hisobotlar
(moliyaviy / davomat / baho / qarzdorlik) · Kundalik uchun eksport

## 3-bosqich

Xarajatlar · Xodimlar va oylik maosh · Click/Payme API · Hujjat generatsiyasi
(shartnoma, ma'lumotnoma PDF) · Arxiv · Chuqur analitika · Super-admin paneli
(tariflar, obunalar, MRR)

## Bajarilish mezonlari (MVP uchun)

- [ ] O'qituvchi 30 kishilik sinf davomatini **40 soniyadan kam** vaqtda oladi
- [ ] Yangi maktabni **1 kunda** ishga tushirish mumkin (Excel import + shablonlar)
- [ ] Bitta maktab boshqasining ma'lumotini ko'ra olmasligi **avtomatik test** bilan qoplangan
- [ ] Har bir to'lov va davomat o'zgarishi audit logda ko'rinadi
- [ ] Internet yo'q bo'lganda davomat yo'qolmaydi
