/**
 * Boshlang'ich ma'lumotlar: 1 superadmin, "Afsona" maktabi, 2026-2027 o'quv yili,
 * 1 admin, 2 o'qituvchi, 4 sinf, 30 o'quvchi (ota-onalari bilan) va 2 oylik hisoblar.
 *
 *   npm run seed        (yoki npm run db:reset — sxema bilan birga)
 */
import bcrypt from 'bcryptjs';
import { pool, tx } from './pool.js';

const SUPERADMIN_PASSWORD = 'superadmin123';
const ADMIN_PASSWORD = 'admin123';
const TEACHER_PASSWORD = 'teacher123';

// O'g'il bolalar 30 tadan 15 tasi, qizlar 15 tasi — ism zaxiralari.
const BOY_NAMES = [
  'Alibek', 'Amirxon', 'Muhammadali', 'Ibrohim', 'Yusuf', 'Umar', 'Bilol',
  'Mustafo', 'Imron', 'Samir', 'Javohir', 'Temur', 'Otabek', 'Sardor', 'Aziz',
];
const GIRL_NAMES = [
  'Madina', 'Sevinch', 'Zilola', 'Munisa', 'Iroda', 'Shahzoda', 'Kamila',
  'Ruxshona', 'Nilufar', 'Gulnora', 'Dilnoza', 'Maftuna', 'Zarina', 'Osiyo', 'Laylo',
];
const SURNAMES = [
  'Karimov', 'Rahimov', 'Toshmatov', 'Ergashev', "Yo'ldoshev", 'Nazarov',
  'Islomov', 'Saidov', 'Qodirov', 'Azimov', 'Xolmatov', 'Mirzayev',
  'Sultonov', 'Abdullayev', 'Usmonov',
];
const FATHER_NAMES = [
  'Baxtiyor', "Ulug'bek", 'Shavkat', 'Botir', 'Rustam', 'Farhod', 'Anvar',
  'Davron', 'Muzaffar', 'Nodir', 'Olim', 'Sherzod', 'Tohir', 'Zafar', 'Ikrom',
];
const MOTHER_NAMES = [
  'Nodira', 'Gulbahor', 'Zulfiya', 'Dilorom', 'Feruza', 'Malika', 'Nargiza',
  'Oydin', 'Sayyora', 'Umida', 'Xurshida', 'Yulduz', 'Zamira', 'Mavluda', 'Rano',
];

// Sinflar: [sinf, harf, oylik to'lov (so'm), tug'ilgan yil, o'quvchilar soni]
const CLASSES: Array<{ grade: number; letter: string; fee: number; birthYear: number; size: number }> = [
  { grade: 1, letter: 'A', fee: 1_500_000, birthYear: 2019, size: 8 },
  { grade: 1, letter: 'B', fee: 1_500_000, birthYear: 2019, size: 8 },
  { grade: 2, letter: 'A', fee: 1_400_000, birthYear: 2018, size: 7 },
  { grade: 3, letter: 'A', fee: 1_300_000, birthYear: 2017, size: 7 },
];

// Hisob chiqariladigan oylar (o'quv yili boshidan 2 oy)
const INVOICE_MONTHS = ['2026-09-01', '2026-10-01'];
const PAYMENT_DUE_DAY = 10;

async function seed() {
  const existing = await pool.query(`SELECT 1 FROM schools WHERE slug = $1`, ['afsona']);
  if (existing.rowCount) {
    console.log("✓ seed allaqachon qo'llangan ('afsona' maktabi mavjud) — o'tkazib yuborildi");
    return;
  }

  const [superHash, adminHash, teacherHash] = await Promise.all([
    bcrypt.hash(SUPERADMIN_PASSWORD, 10),
    bcrypt.hash(ADMIN_PASSWORD, 10),
    bcrypt.hash(TEACHER_PASSWORD, 10),
  ]);

  await tx(async (db) => {
    // -------------------------------------------------------- superadmin
    await db.query(
      `INSERT INTO users (school_id, full_name, phone, password_hash, role)
       VALUES (NULL, $1, $2, $3, 'superadmin')`,
      ['Platforma Administratori', '+998900000000', superHash],
    );

    // -------------------------------------------------------- maktab
    const school = (
      await db.query<{ id: string }>(
        `INSERT INTO schools (name, slug, region, district, address, phone, tg_code, plan, status, settings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'standart', 'active', $8)
         RETURNING id`,
        [
          '"Afsona" xususiy maktabi',
          'afsona',
          'Toshkent shahri',
          'Yunusobod tumani',
          "Amir Temur ko'chasi, 108",
          '+998712000000',
          'afsona2026',
          JSON.stringify({ payment_due_day: PAYMENT_DUE_DAY, grading: { max_score: 100, period: 'weekly' } }),
        ],
      )
    ).rows[0];

    // -------------------------------------------------------- o'quv yili
    const year = (
      await db.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current)
         VALUES ($1, '2026-2027', '2026-09-01', '2027-05-31', true)
         RETURNING id`,
        [school.id],
      )
    ).rows[0];

    // -------------------------------------------------------- xodimlar
    await db.query(
      `INSERT INTO users (school_id, full_name, phone, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [school.id, 'Malika Yusupova', '+998901112233', adminHash],
    );

    const teacherIds: string[] = [];
    for (const [name, phone] of [
      ['Dilnoza Karimova', '+998901112244'],
      ["Jasur Toshpo'latov", '+998901112255'],
    ]) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO users (school_id, full_name, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, 'teacher')
         RETURNING id`,
        [school.id, name, phone, teacherHash],
      );
      teacherIds.push(rows[0].id);
    }

    // -------------------------------------------------------- sinflar
    const classIds: string[] = [];
    for (let c = 0; c < CLASSES.length; c++) {
      const cls = CLASSES[c];
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO classes (school_id, academic_year_id, grade, letter, homeroom_teacher_id, monthly_fee)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [school.id, year.id, cls.grade, cls.letter, teacherIds[c % teacherIds.length], cls.fee],
      );
      classIds.push(rows[0].id);
    }

    // -------------------------------------------------------- o'quvchilar
    let boyIdx = 0;
    let girlIdx = 0;
    let studentNo = 0;

    for (let c = 0; c < CLASSES.length; c++) {
      const cls = CLASSES[c];

      for (let i = 0; i < cls.size; i++) {
        const isBoy = studentNo % 2 === 0;
        const firstName = isBoy ? BOY_NAMES[boyIdx++] : GIRL_NAMES[girlIdx++];
        // 3- va 11- o'quvchilar aka-singil: bitta familiya, bitta ota-ona (N:N tekshiruvi uchun)
        const siblingPair = studentNo === 3 || studentNo === 11;
        const surnameBase = siblingPair ? 'Karimov' : SURNAMES[studentNo % SURNAMES.length];
        const lastName = isBoy ? surnameBase : `${surnameBase}a`;

        const student = (
          await db.query<{ id: string }>(
            `INSERT INTO students (school_id, last_name, first_name, birth_date, gender, enrolled_on)
             VALUES ($1, $2, $3, $4, $5, '2026-09-01')
             RETURNING id`,
            [
              school.id,
              lastName,
              firstName,
              `${cls.birthYear}-0${(studentNo % 9) + 1}-1${studentNo % 9}`,
              isBoy ? 'm' : 'f',
            ],
          )
        ).rows[0];

        // Chegirmalar: aka-singil 10%, har sinfda bittadan grant 50%
        const discountPercent = siblingPair ? 10 : i === cls.size - 1 ? 50 : 0;
        const discountReason =
          discountPercent === 10 ? 'Aka-uka chegirmasi' : discountPercent === 50 ? 'Grant' : null;

        const enrollment = (
          await db.query<{ id: string }>(
            `INSERT INTO enrollments
               (school_id, student_id, class_id, academic_year_id, discount_percent, discount_reason, starts_on)
             VALUES ($1, $2, $3, $4, $5, $6, '2026-09-01')
             RETURNING id`,
            [school.id, student.id, classIds[c], year.id, discountPercent, discountReason],
          )
        ).rows[0];

        // ------------------------------------------------ ota-ona
        // Aka-singil juftligi bitta ota-onaga bog'lanadi (birinchisida yaratiladi).
        const isFather = studentNo % 3 !== 0;
        const parentFirst = isFather
          ? FATHER_NAMES[studentNo % FATHER_NAMES.length]
          : MOTHER_NAMES[studentNo % MOTHER_NAMES.length];
        const parentSurname = isFather ? surnameBase : `${surnameBase}a`;
        const parentPhone = siblingPair
          ? '+998935550003' // ikkala farzand uchun bitta raqam
          : `+99893555${String(1000 + studentNo).slice(-4)}`;

        const parent = (
          await db.query<{ id: string }>(
            `INSERT INTO parents (school_id, full_name, phone, relation)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (school_id, phone) DO UPDATE SET full_name = parents.full_name
             RETURNING id`,
            [school.id, `${parentFirst} ${parentSurname}`, parentPhone, isFather ? 'father' : 'mother'],
          )
        ).rows[0];

        await db.query(
          `INSERT INTO student_parents (student_id, parent_id, is_primary) VALUES ($1, $2, true)`,
          [student.id, parent.id],
        );

        // ------------------------------------------------ hisoblar (2 oy)
        for (const month of INVOICE_MONTHS) {
          const discount = Math.round((cls.fee * discountPercent) / 100);
          const dueDate = `${month.slice(0, 8)}${PAYMENT_DUE_DAY}`;
          await db.query(
            `INSERT INTO invoices
               (school_id, academic_year_id, student_id, enrollment_id, period_month, amount, discount, due_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [school.id, year.id, student.id, enrollment.id, month, cls.fee, discount, dueDate],
          );
        }

        studentNo++;
      }
    }
  });

  console.log('✓ seed tayyor:');
  console.log(`    superadmin  +998900000000 / ${SUPERADMIN_PASSWORD}`);
  console.log(`    admin       +998901112233 / ${ADMIN_PASSWORD}`);
  console.log(`    o'qituvchi  +998901112244, +998901112255 / ${TEACHER_PASSWORD}`);
  console.log(`    "Afsona": 4 sinf, 30 o'quvchi, ${30 * INVOICE_MONTHS.length} ta hisob`);
}

try {
  await seed();
} finally {
  await pool.end();
}
