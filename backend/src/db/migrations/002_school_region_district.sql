-- Maktab manzili O'zbekiston ma'muriy bo'linishiga moslashtiriladi:
-- viloyat -> tuman/shahar -> ko'cha va uy. Bitta `city` maydoni buni ifodalay
-- olmaydi: "Toshkent" viloyatmi yoki shaharmi — noaniq, tumansiz esa maktabni
-- topib bo'lmaydi.
--
-- `address` ustuni 001 dan beri mavjud, shuning uchun bu yerda faqat
-- viloyat va tuman qo'shiladi.

ALTER TABLE schools
  ADD COLUMN region   text,
  ADD COLUMN district text;

-- Mavjud qiymat yo'qolmasin: `city` amalda tuman/shahar darajasi edi.
UPDATE schools SET district = city WHERE city IS NOT NULL AND city <> '';

ALTER TABLE schools DROP COLUMN city;

-- Orqaga qaytarish kerak bo'lsa (qo'lda, chunki migrate.ts da `down` yo'q):
--   ALTER TABLE schools ADD COLUMN city text;
--   UPDATE schools SET city = district;
--   ALTER TABLE schools DROP COLUMN region, DROP COLUMN district;
