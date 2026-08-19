import type { Request } from 'express';
import { z } from 'zod';
import { badRequest } from './errors.js';

/** Zod xatosini foydalanuvchiga tushunarli 400 ga aylantiradi. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw badRequest(result.error.issues[0]?.message ?? "Ma'lumot noto'g'ri");
  return result.data;
}

const uuidSchema = z.string().uuid("ID formati noto'g'ri");

/** URL'dagi :id kabi parametrlar Postgres'ga yetmasidan tekshiriladi (500 o'rniga 400). */
export function uuidParam(req: Request, name = 'id'): string {
  return parse(uuidSchema, req.params[name]);
}
