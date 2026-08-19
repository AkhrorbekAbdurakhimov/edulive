-- Maktab logotipi. Faylning o'zi diskda (`UPLOAD_DIR`), bazada faqat
-- ommaviy yo'l saqlanadi: masalan `/uploads/schools/<id>-<rand>.png`.
--
-- Fayl bazaga solinmaydi — pg_dump zaxiralari kattalashib ketardi va
-- rasm har so'rovda bazadan o'qilardi. Statik fayl Caddy orqali beriladi.

ALTER TABLE schools ADD COLUMN logo_url text;
