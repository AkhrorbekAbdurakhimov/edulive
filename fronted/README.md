# EduLive — web (React + TypeScript + Vite)

```bash
npm install
npm run dev       # http://localhost:5173  → /api backend'ga proksi qilinadi
```

## Dizayn

Barcha rang, o'lcham va radius `src/styles/tokens.css` da. **Komponentda
to'g'ridan-to'g'ri hex yozmang** — faqat `var(--...)`.

Tayyor maket: `../development/web-ui.dc.html` (brauzerda oching, light/dark
almashadi, jadval va diagrammalar ishlaydi). Spetsifikatsiya:
`../development/DESIGN_PROMPT.md`.

## Qoidalar

- Pul va raqam ustunlari — `className="num"` (tabular-nums).
- Status rangi **hech qachon yolg'iz** ma'no tashimaydi: ikonka + so'z.
- Har bir ekranda loading (skeleton) / empty / error holati bo'lishi shart.
- 640px dan pastda jadval kartaga aylanadi, gorizontal scroll YO'Q.
