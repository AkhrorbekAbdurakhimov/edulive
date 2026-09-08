-- Xodimlarni xizmat botiga ulash (@eduliveuz_bot).
--
-- Ota-onalar boti bilan aralashtirilmaydi: u ota-onaga farzandi haqida
-- xabar beradi, bu esa egasi va ma'muriyatga hisobot, zaxira nusxa va
-- muhim hodisalarni yuboradi.
--
-- Chat raqami QO'LDA yozilmaydi: xodim ilovadan bir martalik kod oladi va
-- botga /start <kod> deb yuboradi. Shunda chat aynan o'sha hisobga bog'lanadi
-- va kimdir boshqaning chatini qo'lda kiritib qo'ya olmaydi.
ALTER TABLE users ADD COLUMN telegram_chat_id bigint;
CREATE UNIQUE INDEX users_tg ON users (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

CREATE TABLE telegram_link_codes (
  code       text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_link_codes_user ON telegram_link_codes (user_id);
