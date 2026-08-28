-- Har bir maktab o'z Telegram botini ulashi mumkin. Token to'ldirilmagan
-- bo'lsa platforma boti ishlatiladi — maktab hech narsa qilmasdan ishlaydi.

ALTER TABLE schools
  -- AES-256-GCM bilan shifrlangan. Ochiq matnda saqlansa, baza nusxasi
  -- (kunlik zaxira fayli ham) sizib ketganda barcha maktablarning botlari
  -- begonaga o'tardi.
  ADD COLUMN telegram_bot_token_enc  text,
  ADD COLUMN telegram_bot_username   text,
  -- Webhook manzilidagi tasodifiy segment: qaysi maktab kelganini shu aniqlaydi.
  ADD COLUMN telegram_webhook_secret text;

CREATE UNIQUE INDEX schools_webhook_secret
  ON schools (telegram_webhook_secret) WHERE telegram_webhook_secret IS NOT NULL;

-- Bitta Telegram chati maktab ichida faqat bitta ota-onaga bog'lanadi.
-- Aks holda bir chatga ikki xil oilaning xabari ketib qolishi mumkin edi.
CREATE UNIQUE INDEX parents_chat_unique
  ON parents (school_id, telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;
