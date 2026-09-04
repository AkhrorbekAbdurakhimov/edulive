-- Kutubxona: kitob nomlari, jismoniy nusxalar va berish yozuvlari.
--
-- Nima uchun nom va nusxa alohida: "Alpomish" bitta nom, lekin javonda 12 dona
-- turadi va har birining o'z inventar raqami bor. Yo'qolgan kitobni hisobdan
-- chiqarish uchun aynan qaysi dona ekani bilinishi shart — buxgalteriya shuni
-- talab qiladi.

-- Kutubxonachi huquqi — ROL emas, BELGI. Sabab: o'qituvchi bir vaqtning o'zida
-- kutubxonachi ham bo'ladi; rol bitta bo'lgani uchun uni rolga aylantirsak,
-- odam o'z sinflarini ko'rmay qolardi.
ALTER TABLE users ADD COLUMN is_librarian boolean NOT NULL DEFAULT false;

CREATE TABLE books (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title           text NOT NULL,
  author          text,
  category        text NOT NULL DEFAULT 'boshqa'
                    CHECK (category IN ('darslik','badiiy','qollanma','ilmiy','boshqa')),
  -- Darslik bo'lsa qaysi sinf uchun; badiiy kitobda NULL.
  grade           smallint CHECK (grade BETWEEN 1 AND 11),
  language        text NOT NULL DEFAULT 'uz'
                    CHECK (language IN ('uz','ru','en','other')),
  publisher       text,
  published_year  smallint CHECK (published_year BETWEEN 1800 AND 2100),
  isbn            text,
  shelf           text,                    -- javon/bo'lim kodi
  -- Yo'qotilganda undiriladigan qiymat. Pul har doim numeric.
  price           numeric(14,2) CHECK (price IS NULL OR price >= 0),
  cover_url       text,
  note            text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX books_school ON books (school_id, title);
CREATE INDEX books_category ON books (school_id, category, grade);

-- Jismoniy dona. Inventar raqami maktab ichida takrorlanmaydi.
CREATE TABLE book_copies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  book_id       uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  inventory_no  text NOT NULL,
  condition     text NOT NULL DEFAULT 'good'
                  CHECK (condition IN ('new','good','worn','damaged')),
  status        text NOT NULL DEFAULT 'shelf'
                  CHECK (status IN ('shelf','issued','lost','repair','written_off')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, inventory_no)
);
CREATE INDEX book_copies_book ON book_copies (book_id, status);

-- Kitob berish yozuvi ("shartnoma"). Tarix hech qachon o'chirilmaydi.
CREATE TABLE book_loans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  -- RESTRICT: qo'lida kitob bor nusxa o'chirilmasin, tarix uzilmasin.
  copy_id        uuid NOT NULL REFERENCES book_copies(id) ON DELETE RESTRICT,
  book_id        uuid NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  issued_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_on      date NOT NULL DEFAULT CURRENT_DATE,
  due_on         date NOT NULL,
  returned_on    date,
  received_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  condition_out  text NOT NULL DEFAULT 'good'
                   CHECK (condition_out IN ('new','good','worn','damaged')),
  condition_in   text CHECK (condition_in IN ('new','good','worn','damaged')),
  status         text NOT NULL DEFAULT 'issued'
                   CHECK (status IN ('issued','returned','lost')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on >= issued_on),
  CHECK ((status = 'issued') = (returned_on IS NULL AND condition_in IS NULL))
);

-- Bitta nusxa bir vaqtda faqat bitta o'quvchida bo'ladi. Buni kodda emas,
-- bazada ushlaymiz: ikki kutubxonachi bir vaqtda bersa ham ikkinchisi rad etiladi.
CREATE UNIQUE INDEX book_loans_active ON book_loans (copy_id) WHERE status = 'issued';
CREATE INDEX book_loans_student ON book_loans (school_id, student_id, issued_on DESC);
CREATE INDEX book_loans_due ON book_loans (school_id, due_on) WHERE status = 'issued';
