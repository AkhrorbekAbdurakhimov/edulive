export type Role = 'superadmin' | 'admin' | 'manager' | 'teacher';

export interface AuthUser {
  id: string;
  /** superadmin uchun null */
  schoolId: string | null;
  role: Role;
  fullName: string;
  tokenVersion: number;
}

export interface JwtPayload {
  sub: string;
  sid: string | null;
  role: Role;
  tv: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** Har bir so'rovda majburiy tenant filtri. tenant middleware to'ldiradi. */
      schoolId?: string;
    }
  }
}
