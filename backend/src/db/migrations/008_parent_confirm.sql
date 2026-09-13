-- Ota-ona botga ulanganda farzand ma'lumotini TASDIQLAYDI.
--
-- Nega kerak: raqam bir oiladan ikkinchisiga o'tib ketishi mumkin (eski
-- raqam boshqa odamga sotiladi), import paytida raqam noto'g'ri yozilishi ham
-- mumkin. Shunda begona odam boshqaning farzandi haqida davomat va to'lov
-- xabarlarini olib turardi. Endi bot avval farzand ma'lumotini ko'rsatadi va
-- "Ha / Yo'q" so'raydi.
--
-- Holatlar `parent_phones` da:
--   chat_id NULL                                  -- botga umuman ulanmagan
--   chat_id bor, verified NULL, rejected NULL     -- tasdiq kutilmoqda
--   verified_at bor                               -- tasdiqlangan, xabar ketadi
--   rejected_at bor                               -- "bu mening farzandim emas"
-- Xabar FAQAT verified_at to'ldirilgan raqamga ketadi.
ALTER TABLE parent_phones ADD COLUMN telegram_rejected_at timestamptz;

-- Ota-ona "Yo'q" degan holat ma'muriyat ko'zidan qochmasin.
CREATE INDEX parent_phones_rejected ON parent_phones (school_id)
  WHERE telegram_rejected_at IS NOT NULL;
