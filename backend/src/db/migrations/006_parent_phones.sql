-- Mas'ul shaxsning bir nechta telefoni.
--
-- Nega alohida jadval: Telegram chati RAQAMGA bog'lanadi, odamga emas. Ota
-- ikkita raqamdan foydalansa (ish va shaxsiy), ikkalasi ham botga ulanishi va
-- ikkalasiga ham xabar borishi kerak. `parents.phone` bitta bo'lgani uchun
-- buni ifodalab bo'lmasdi.
--
-- Telefonga oid hamma narsa shu yerga ko'chadi: `parents` endi faqat ODAM
-- (ismi va qarindoshligi). Ikki joyda saqlansa, ular albatta bir-biridan
-- uzilib ketadi — Telegram ulanishi aynan shunday jimgina buzilardi.

CREATE TABLE parent_phones (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id            uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  phone                text NOT NULL,
  -- Asosiy raqam — ro'yxatlarda va qo'ng'iroq uchun shu ko'rsatiladi.
  is_primary           boolean NOT NULL DEFAULT false,
  telegram_chat_id     bigint,
  telegram_verified_at timestamptz,
  -- Xabarni raqam darajasida o'chirish mumkin: ish raqamiga kerak emas deyishi mumkin.
  notify_enabled       boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Bitta raqam maktabda bitta odamga tegishli.
  UNIQUE (school_id, phone)
);
CREATE INDEX parent_phones_parent ON parent_phones (parent_id);
-- Bitta Telegram chati bitta raqamga bog'lanadi.
CREATE UNIQUE INDEX parent_phones_tg ON parent_phones (telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- Mavjud ma'lumot ko'chiriladi: har bir ota-onaning raqami asosiy bo'ladi.
INSERT INTO parent_phones
  (school_id, parent_id, phone, is_primary, telegram_chat_id, telegram_verified_at, notify_enabled)
SELECT school_id, id, phone, true, telegram_chat_id, telegram_verified_at, notify_enabled
  FROM parents;

-- Endi eski ustunlar ortiqcha — ikkinchi haqiqat manbai qolmasin.
DROP INDEX IF EXISTS parents_tg;
ALTER TABLE parents
  DROP COLUMN phone,
  DROP COLUMN telegram_chat_id,
  DROP COLUMN telegram_verified_at,
  DROP COLUMN notify_enabled;

-- Xabar CHATGA boradi, chat esa raqamga tegishli — shuning uchun bildirishnoma
-- endi raqamni ko'rsatadi. parent_id qoladi: kimga yuborilgani ko'rinishi kerak.
ALTER TABLE notifications
  ADD COLUMN parent_phone_id uuid REFERENCES parent_phones(id) ON DELETE CASCADE;

-- Eski bildirishnomalar ota-onaning asosiy raqamiga bog'lanadi.
UPDATE notifications n
   SET parent_phone_id = pp.id
  FROM parent_phones pp
 WHERE pp.parent_id = n.parent_id AND pp.is_primary;
