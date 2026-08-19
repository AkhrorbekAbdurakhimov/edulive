import type { Request } from 'express';
import { pool, type Db } from '../../db/pool.js';

interface AuditInput {
  action: string;              // 'payment.create'
  entity: string;              // 'payment'
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Audit yozuvi. HECH QACHON o'chirilmaydi va yangilanmaydi.
 * Pul va davomat bilan bog'liq har bir o'zgarish shu yerdan o'tadi.
 * Tranzaksiya ichida chaqirilsa `db` sifatida o'sha client uzatiladi.
 */
export async function audit(req: Request, input: AuditInput, db: Db = pool): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (school_id, actor_id, actor_role, action, entity, entity_id, before, after, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      req.schoolId ?? null,
      req.user?.id ?? null,
      req.user?.role ?? null,
      input.action,
      input.entity,
      input.entityId ?? null,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      req.ip ?? null,
      req.header('user-agent') ?? null,
    ],
  );
}
