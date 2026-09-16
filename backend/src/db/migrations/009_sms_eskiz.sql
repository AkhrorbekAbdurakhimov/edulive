-- SMS kanali (Eskiz.uz).
--
-- Nega kerak: qarz eslatmasi Telegram orqali faqat BOTGA ULANGAN ota-onaga
-- yetadi. Amalda ulanmaganlar ko'p, ular esa aynan eslatma kerak bo'lganlar.
-- SMS hech narsa talab qilmaydi — raqam bo'lsa bo'ldi.
--
-- Telegram bilan bir xil naqsh: platforma hisobi `.env` da, maktab xohlasa
-- O'Z hisobini ulaydi. SMS pullik — har maktab o'zi to'lagani ma'qul, lekin
-- ulamagani ham birinchi kundan ishlayveradi.

ALTER TABLE schools
  ADD COLUMN eskiz_email      text,
  -- AES-256-GCM. Ochiq matnda yotsa, zaxira fayli sizib ketganda maktabning
  -- SMS balansi begonaning ixtiyoriga o'tadi (bot tokeni bilan bir xil xavf).
  ADD COLUMN eskiz_secret_enc text,
  -- Tasdiqlangan jo'natuvchi nomi. Eskizda moderatsiyadan o'tmagan nik bilan
  -- xabar ketmaydi; 4546 — hammaga ochiq sinov niki.
  ADD COLUMN eskiz_from       text;

-- Eskiz jo'natish javobida UUID qaytaradi va yetkazilganlik xabarini (DLR)
-- shu UUID bilan uradi. Busiz "yuborildi" va "yetib bordi" farqlanmaydi.
ALTER TABLE notifications
  ADD COLUMN provider_id text,
  -- Telefon raqami xabar YOZILGAN paytdagi holicha saqlanadi: raqam keyin
  -- o'zgartirilsa yoki o'chirilsa ham, qayerga ketganini bilib bo'lsin.
  ADD COLUMN to_phone    text,
  ADD COLUMN delivered_at timestamptz;

CREATE UNIQUE INDEX notifications_provider ON notifications (provider_id)
  WHERE provider_id IS NOT NULL;

-- Navbat indeksi kanalni hisobga olmasdi; endi ikki kanal bor.
DROP INDEX IF EXISTS notifications_queue;
CREATE INDEX notifications_queue ON notifications (channel, created_at)
  WHERE status = 'queued';
