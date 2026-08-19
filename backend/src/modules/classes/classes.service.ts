import { pool, type Db } from '../../db/pool.js';
import { forbidden } from '../../utils/errors.js';
import type { AuthUser } from '../../types/auth.js';

/**
 * O'qituvchi ko'ra oladigan sinflar: sinf rahbarligi + fan biriktirilgan sinflar.
 * O'qituvchining butun ko'rish huquqi shu ikki manbadan chiqadi (CLAUDE.md).
 */
export async function teacherClassIds(schoolId: string, teacherId: string, db: Db = pool): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT c.id
       FROM classes c
      WHERE c.school_id = $1 AND c.homeroom_teacher_id = $2
     UNION
     SELECT cst.class_id
       FROM class_subject_teachers cst
      WHERE cst.school_id = $1 AND cst.teacher_id = $2`,
    [schoolId, teacherId],
  );
  return rows.map((r) => r.id);
}

/** teacher roli uchun sinfga kirishni tekshiradi; admin/manager/superadmin cheklanmaydi. */
export async function assertClassAccess(user: AuthUser, schoolId: string, classId: string): Promise<void> {
  if (user.role !== 'teacher') return;
  const ids = await teacherClassIds(schoolId, user.id);
  if (!ids.includes(classId)) throw forbidden("Bu sinf sizga biriktirilmagan");
}
