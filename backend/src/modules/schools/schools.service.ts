import { pool, type Db } from '../../db/pool.js';
import { badRequest } from '../../utils/errors.js';

export interface AcademicYear {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
}

/** Joriy o'quv yili — ko'p modul shu yilga bog'lab ishlaydi. */
export async function getCurrentYear(schoolId: string, db: Db = pool): Promise<AcademicYear> {
  const { rows } = await db.query<AcademicYear>(
    `SELECT id, name, starts_on, ends_on, is_current
       FROM academic_years
      WHERE school_id = $1 AND is_current`,
    [schoolId],
  );
  if (!rows[0]) throw badRequest("Joriy o'quv yili belgilanmagan. Avval o'quv yilini yarating");
  return rows[0];
}

/** schools.settings dan qiymat — hardcode o'rniga (3-qoida). */
export async function getSchoolSettings(schoolId: string, db: Db = pool): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ settings: Record<string, unknown> }>(
    `SELECT settings FROM schools WHERE id = $1`,
    [schoolId],
  );
  if (!rows[0]) throw badRequest('Maktab topilmadi');
  return rows[0].settings;
}
