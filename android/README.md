# EduLive — o'qituvchi ilovasi (React Native + Expo)

```bash
npm install
npx expo start          # QR kodni Expo Go bilan skanerlang
npm run android         # emulyator/qurilmada
```

Emulyatorda backend manzili `http://10.0.2.2:4000` (app.json → extra.apiUrl).

## Nima uchun Expo

Backend va web bilan bir xil til (TypeScript) va bir xil tiplar. Tokenlar
`src/theme.ts` da — web'dagi `tokens.css` bilan **bir xil qiymatlar**.

## Asosiy qoidalar

1. **Davomatda sukut holati "Keldi".** O'qituvchi faqat kelmaganlarni bosadi.
   28 ta teginish emas, 2–3 ta. Bu ilovaning qabul qilinishini hal qiladi.
2. **Tasdiqlash tugmasi doim bosh barmoq zonasida** (ekranning pastki 1/3).
3. **Oflayn-first.** Koridorda internet yo'qligi normal holat: davomat lokal
   saqlanadi (AsyncStorage), aloqa tiklanganda yuboriladi. Faqat server
   tasdiqlagandan keyin ota-onaga xabar ketadi.
4. **Teginish nishoni ≥ 44dp** (`HIT` konstantasi).
5. Orqaga tugmasi tasdiqlanmagan davomatni yo'qotmaydi — qoralama saqlanadi.

Maket: `../development/mobile-ui.dc.html` (9 ta ekran + Telegram bot oqimi).
