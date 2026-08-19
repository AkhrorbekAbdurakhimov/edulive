export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (m: string, code?: string) => new AppError(400, m, code);
export const unauthorized = (m = 'Avtorizatsiya talab qilinadi') => new AppError(401, m);
export const forbidden = (m = 'Ruxsat yo\'q') => new AppError(403, m);
export const notFound = (m = 'Topilmadi') => new AppError(404, m);
export const conflict = (m: string, code?: string) => new AppError(409, m, code);
export const tooManyRequests = (m = 'Urinishlar soni oshib ketdi. Birozdan keyin qayta urinib ko\'ring') =>
  new AppError(429, m);
