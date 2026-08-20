import type { Db } from '../../db/pool.js';

/**
 * Ota-onani telefon bo'yicha topadi yoki yaratadi va o'quvchiga bog'laydi.
 *
 * Telefon maktab ichida noyob (parents.UNIQUE(school_id, phone)) — bir oilaning
 * bir necha farzandi bo'lsa, ular bitta ota-ona yozuviga bog'lanadi.
 */
export async function linkParent(
  db: Db,
  schoolId: string,
  studentId: string,
  // Importda qarindoshlik ko'rsatilmasligi mumkin — noto'g'ri taxmin qilgandan
  // ko'ra bo'sh qoldirgan ma'qul (Telegram xabarlari shunga qarab yoziladi).
  p: { fullName: string; phone: string; relation: string | null },
  isPrimary: boolean,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO parents (school_id, full_name, phone, relation)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (school_id, phone) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [schoolId, p.fullName, p.phone, p.relation],
  );
  await db.query(
    `INSERT INTO student_parents (student_id, parent_id, is_primary)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [studentId, rows[0].id, isPrimary],
  );
  return rows[0].id;
}
