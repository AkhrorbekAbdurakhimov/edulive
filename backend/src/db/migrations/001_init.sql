-- =====================================================================
-- EduLive — boshlang'ich sxema (multi-tenant)
--
-- ASOSIY QOIDALAR (buzilmasin):
--   1. Har bir jadvalda school_id bor. Har bir so'rovda u majburiy filtr.
--   2. Har narsa academic_year_id ga bog'lanadi — o'quv yili birinchi
--      darajali obyekt, keyin qo'shib bo'lmaydi.
--   3. Davomatda lesson_id NULL bo'lishi mumkin: NULL = kuniga 1 marta.
--      Kelajakda dars bo'yicha davomatga o'tilganda migratsiya kerak emas.
--   4. To'lovda idempotency_key bor — Click/Payme webhook'i bir to'lovni
--      ikki marta yozib qo'ymasligi uchun.
--   5. Moliyaviy va davomat o'zgarishlari audit_log ga yoziladi.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- tenant
CREATE TABLE schools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text NOT NULL UNIQUE,
  city           text,
  phone          text,
  address        text,
  -- Telegram deep link kodi: t.me/edulive_bot?start=<code>
  tg_code        text NOT NULL UNIQUE,
  plan           text NOT NULL DEFAULT 'standart' CHECK (plan IN ('trial','standart','pro')),
  status         text NOT NULL DEFAULT 'active'   CHECK (status IN ('active','suspended','trial')),
  -- Sozlanuvchan hamma narsa shu yerda: to'lov muddati kuni, baho tizimi,
  -- sinf tuzilishi, bildirishnoma vaqtlari. Kodda hardcode QILINMAYDI.
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE academic_years (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name           text NOT NULL,                  -- '2026–2027'
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  is_current     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  CHECK (ends_on > starts_on)
);
-- Bir maktabda faqat bitta joriy o'quv yili bo'ladi.
CREATE UNIQUE INDEX academic_years_one_current ON academic_years (school_id) WHERE is_current;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = platforma super-admini (barcha maktablarni ko'radi)
  school_id      uuid REFERENCES schools(id) ON DELETE CASCADE,
  full_name      text NOT NULL,
  phone          text,
  email          text,
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('superadmin','admin','manager','teacher')),
  is_active      boolean NOT NULL DEFAULT true,
  -- parol o'zgarganda yoki chiqarilganda oshiriladi → eski JWT bekor bo'ladi
  token_version  integer NOT NULL DEFAULT 0,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (role = 'superadmin' OR school_id IS NOT NULL)
);
CREATE UNIQUE INDEX users_school_phone ON users (school_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX users_school_role ON users (school_id, role) WHERE is_active;

-- ---------------------------------------------------------------- academics
CREATE TABLE subjects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name           text NOT NULL,
  short_name     text,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (school_id, name)
);

CREATE TABLE classes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id     uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  grade                smallint NOT NULL CHECK (grade BETWEEN 0 AND 12),
  letter               text NOT NULL,
  homeroom_teacher_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- sinf uchun standart oylik to'lov; o'quvchida override bo'lishi mumkin
  monthly_fee          numeric(14,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year_id, grade, letter)
);
CREATE INDEX classes_teacher ON classes (homeroom_teacher_id);

-- Qaysi o'qituvchi qaysi sinfga qaysi fandan dars beradi.
-- O'qituvchining ko'rish huquqi shu jadvaldan chiqadi.
CREATE TABLE class_subject_teachers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id       uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id     uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (class_id, subject_id)
);
CREATE INDEX cst_teacher ON class_subject_teachers (teacher_id);

-- Dars jadvali. Hozircha davomat kuniga 1 marta olinadi (lesson_id NULL),
-- lekin jadval tayyor tursin — dars bo'yicha davomatga o'tish oson bo'ladi.
CREATE TABLE lessons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id        uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  weekday           smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- 1 = dushanba
  period            smallint NOT NULL CHECK (period BETWEEN 1 AND 12),
  starts_at         time,
  ends_at           time,
  room              text,
  UNIQUE (class_id, weekday, period)
);

-- ---------------------------------------------------------------- students
CREATE TABLE students (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  last_name      text NOT NULL,
  first_name     text NOT NULL,
  middle_name    text,
  birth_date     date,
  gender         text CHECK (gender IN ('m','f')),
  external_id    text,                    -- maktabning o'z ID raqami
  photo_url      text,
  enrolled_on    date NOT NULL DEFAULT CURRENT_DATE,
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','archived','graduated','left')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX students_school_status ON students (school_id, status);
CREATE UNIQUE INDEX students_external ON students (school_id, external_id) WHERE external_id IS NOT NULL;

-- O'quvchi + o'quv yili + sinf. Sinf o'zgarsa tarix saqlanadi.
CREATE TABLE enrollments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  -- sinf narxidan farq qilsa shu yerda; NULL = sinf narxi
  monthly_fee       numeric(14,2) CHECK (monthly_fee IS NULL OR monthly_fee >= 0),
  -- chegirma: aka-uka, xodim farzandi, grant
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  discount_reason   text,
  starts_on         date NOT NULL DEFAULT CURRENT_DATE,
  ends_on           date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, academic_year_id)
);
CREATE INDEX enrollments_class ON enrollments (class_id) WHERE ends_on IS NULL;

CREATE TABLE parents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name            text NOT NULL,
  phone                text NOT NULL,
  relation             text CHECK (relation IN ('father','mother','guardian')),
  telegram_chat_id     bigint,
  telegram_verified_at timestamptz,
  notify_enabled       boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, phone)
);
CREATE UNIQUE INDEX parents_tg ON parents (telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Bitta ota-onada bir nechta farzand bo'lishi mumkin — shuning uchun N:N.
CREATE TABLE student_parents (
  student_id  uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id   uuid NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (student_id, parent_id)
);

-- ---------------------------------------------------------------- attendance
-- O'qituvchi "tasdiqlash" bosgan sessiya. Tasdiqlanmaguncha xabar ketmaydi.
CREATE TABLE attendance_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id       uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  on_date        date NOT NULL,
  lesson_id      uuid REFERENCES lessons(id) ON DELETE SET NULL,  -- NULL = kunlik
  taken_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at   timestamptz,
  total_count    integer NOT NULL DEFAULT 0,
  present_count  integer NOT NULL DEFAULT 0,
  absent_count   integer NOT NULL DEFAULT 0,
  late_count     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- lesson_id NULL bo'lganda ham takrorlanmasin (COALESCE bilan ifodali indeks).
CREATE UNIQUE INDEX attendance_sessions_uniq
  ON attendance_sessions (class_id, on_date, COALESCE(lesson_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id     uuid REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id       uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  on_date        date NOT NULL,
  lesson_id      uuid REFERENCES lessons(id) ON DELETE SET NULL,
  status         text NOT NULL CHECK (status IN ('present','absent','late')),
  minutes_late   smallint CHECK (minutes_late IS NULL OR minutes_late >= 0),
  reason         text,
  reason_status  text NOT NULL DEFAULT 'none'
                   CHECK (reason_status IN ('none','pending','approved','rejected')),
  -- manual = o'qituvchi qo'lda; auto = turniket/QR; device = boshqa qurilma.
  -- DIQQAT: yuz orqali davomat qo'shilsa, bu biometrik ma'lumot bo'ladi va
  -- qonun bo'yicha O'zbekistondagi serverda saqlanishi shart.
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','device')),
  taken_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX attendance_uniq
  ON attendance (student_id, on_date, COALESCE(lesson_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX attendance_class_date ON attendance (class_id, on_date);
CREATE INDEX attendance_school_date ON attendance (school_id, on_date);
CREATE INDEX attendance_absent ON attendance (school_id, on_date) WHERE status <> 'present';

-- ---------------------------------------------------------------- grades
-- Baho tizimi SOZLAMA — kodda emas. Hozir: 100 ball, haftalik, mezonsiz.
-- Keyin mezonlarga bo'lish = shu yerdagi criteria ni to'ldirish, migratsiya emas.
CREATE TABLE grading_schemes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  max_score         integer NOT NULL DEFAULT 100 CHECK (max_score > 0),
  period            text NOT NULL DEFAULT 'weekly' CHECK (period IN ('weekly','monthly')),
  -- [{"key":"knowledge","label":"Bilim","max":40}, ...]  bo'sh = yagona umumiy ball
  criteria          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, academic_year_id)
);

CREATE TABLE grades (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id          uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id        uuid NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  period_start      date NOT NULL,           -- hafta boshi (dushanba)
  period_end        date NOT NULL,
  score             numeric(5,2) NOT NULL CHECK (score >= 0),
  breakdown         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"knowledge":32,...}
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id, period_start)
);
CREATE INDEX grades_class_period ON grades (class_id, period_start);

-- ---------------------------------------------------------------- finance
-- Oylik hisob. Har oy boshida generatsiya qilinadi (scheduler).
CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id  uuid NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  student_id        uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  enrollment_id     uuid REFERENCES enrollments(id) ON DELETE SET NULL,
  period_month      date NOT NULL,                        -- har doim oyning 1-kuni
  amount            numeric(14,2) NOT NULL CHECK (amount >= 0),
  discount          numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  due_date          date NOT NULL,
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','partial','paid','void')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, period_month)
);
CREATE INDEX invoices_open ON invoices (school_id, due_date) WHERE status IN ('open','partial');

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  provider         text NOT NULL CHECK (provider IN ('cash','click','payme','transfer','manual')),
  external_id      text,                                  -- provayder tranzaksiya raqami
  status           text NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('pending','confirmed','failed','refunded')),
  -- Click/Payme webhook'i bitta to'lovni ikki marta yozmasligi uchun.
  idempotency_key  text,
  paid_at          timestamptz NOT NULL DEFAULT now(),
  received_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  note             text,
  receipt_no       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_idempotent
  ON payments (school_id, provider, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX payments_school_paid ON payments (school_id, paid_at DESC);
CREATE INDEX payments_student ON payments (student_id, paid_at DESC);

-- Bitta to'lov bir nechta oyni yopishi mumkin.
CREATE TABLE payment_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id  uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0)
);
CREATE INDEX pay_alloc_invoice ON payment_allocations (invoice_id);

CREATE TABLE expense_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       text NOT NULL,
  UNIQUE (school_id, name)
);

CREATE TABLE expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  category_id  uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  spent_on     date NOT NULL DEFAULT CURRENT_DATE,
  -- maosh xarajati bo'lsa: qaysi xodim, qaysi oy
  staff_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  salary_month date,
  note         text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_school_date ON expenses (school_id, spent_on DESC);

-- ---------------------------------------------------------------- notifications
-- 9-modul (Telegram bot) va 12-modul (Bildirishnomalar) BITTA tizim.
-- Kanal — parametr, alohida kod emas.
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES parents(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,   -- admin bildirishnomasi
  student_id   uuid REFERENCES students(id) ON DELETE CASCADE,
  channel      text NOT NULL DEFAULT 'telegram'
                 CHECK (channel IN ('telegram','sms','inapp')),
  kind         text NOT NULL,     -- attendance.present | attendance.absent | payment.received ...
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  body         text,
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','failed','read')),
  error        text,
  attempts     smallint NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NOT NULL OR user_id IS NOT NULL)
);
CREATE INDEX notifications_queue ON notifications (status, created_at) WHERE status = 'queued';
CREATE INDEX notifications_school ON notifications (school_id, created_at DESC);

-- ---------------------------------------------------------------- audit
-- Hech qachon o'chirilmaydi va yangilanmaydi — faqat qo'shiladi.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  school_id   uuid,
  actor_id    uuid,
  actor_role  text,
  action      text NOT NULL,     -- 'payment.create', 'attendance.update', 'school.impersonate'
  entity      text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_school_time ON audit_log (school_id, created_at DESC);
CREATE INDEX audit_entity ON audit_log (entity, entity_id);
CREATE INDEX audit_actor ON audit_log (actor_id, created_at DESC);
