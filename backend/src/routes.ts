import { Router } from 'express';
import { authenticate } from './middleware/auth.js';
import { resolveTenant } from './middleware/tenant.js';
import { pool } from './db/pool.js';
import { ah } from './utils/http.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { schoolsPlatformRoutes, schoolRoutes, yearsRoutes } from './modules/schools/schools.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { classesRoutes } from './modules/classes/classes.routes.js';
import { studentsRoutes } from './modules/students/students.routes.js';
import { attendanceRoutes } from './modules/attendance/attendance.routes.js';
import { invoicesRoutes, paymentsRoutes } from './modules/payments/payments.routes.js';
import { debtorsRoutes } from './modules/debtors/debtors.routes.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';

export const api = Router();

// --- ochiq yo'llar -----------------------------------------------------
api.get('/health', ah(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, ts: new Date().toISOString() });
}));

api.use('/auth', authRoutes);

// --- himoyalangan yo'llar ---------------------------------------------
api.use(authenticate, resolveTenant);

api.get('/me', (req, res) => {
  res.json({ user: req.user, schoolId: req.schoolId ?? null });
});

api.use('/schools', schoolsPlatformRoutes); // faqat superadmin
api.use('/school', schoolRoutes);
api.use('/years', yearsRoutes);
api.use('/users', usersRoutes);
api.use('/classes', classesRoutes);
api.use('/students', studentsRoutes);
api.use('/attendance', attendanceRoutes);
api.use('/invoices', invoicesRoutes);
api.use('/payments', paymentsRoutes);
api.use('/debtors', debtorsRoutes);
api.use('/audit', auditRoutes);
api.use('/dashboard', dashboardRoutes);

// TODO — keyingi bosqichlar:
// api.use('/grades',   gradeRoutes);     // 2-bosqich
// api.use('/reports',  reportRoutes);    // 2-bosqich
// api.use('/telegram', telegramRoutes);  // bot webhook
