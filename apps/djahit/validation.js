import { z } from 'zod';
import { AppError } from './errors.js';
import { serviceCategories } from './service-categories.js';

const text = (min, max) => z.string().trim().min(min).max(max);
const integer = (min, max) => z.union([z.number(), z.string().regex(/^\d+$/)])
  .transform(Number).pipe(z.number().int().min(min).max(max));
const bool = z.union([z.boolean(), z.enum(['true', 'false'])]).transform(value => value === true || value === 'true');
const date = z.iso.date().refine(value => value >= '2000-01-01', 'Choose a valid date.');
export const phone = z.string().trim().regex(/^(?:\+?[1-9]\d{7,14}|0\d{8,12})$/)
  .transform(value => value.replace(/^\+/, '').replace(/^0/, '62'));
export const id = z.uuid();
const revision = integer(1, 2147483647);
const detail = text(0, 500).default('').transform(value => value || null);
const optionalText = max => z.union([text(0, max), z.null()]).optional().transform(value => value === '' ? null : value);
const optionalNumber = (min, max) => z.union([integer(min, max), z.literal(''), z.null()]).optional()
  .transform(value => value === '' ? null : value);

export const email = z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase());
export const login = z.object({
  email,
  password: z.string().min(1).max(128)
});
export const service = z.object({
  name: text(3, 80), description: text(5, 300), price: integer(0, 100000000), active: bool,
  category: z.enum(Object.keys(serviceCategories)).optional(),
  leadDays: optionalNumber(1, 365), intakeHint: optionalText(300)
});
export const businessProfile = z.object({
  name: text(3, 80), area: text(3, 100), description: text(10, 600)
});
export const inquiry = z.object({
  serviceId: id, description: text(10, 1500),
  desiredDate: z.union([date, z.literal(''), z.null()]).optional().transform(value => value || null),
  key: id, quantity: optionalNumber(1, 50), fitNotes: optionalText(500)
});
export const inquiryAction = z.object({
  action: z.enum(['review', 'clarify', 'respond', 'question','decline', 'cancel']), revision, detail
}).refine(value => value.action === 'review' || value.detail, { message: 'Enter a note for this action.' });
const lineItem = z.object({ name: text(2, 100), quantity: integer(1, 100), unitPrice: integer(0, 100000000) });
export const quote = z.object({
  amount: integer(1, 100000000).optional(), items: z.array(lineItem).min(1).max(8).optional(),
  handover: z.enum(['pickup','delivery']).optional(),
  fittingAt: z.union([z.iso.datetime({local:true}), z.literal('')]).optional(),
  fittingPlace: optionalText(200),
  eta: date, terms: text(5, 1000), validHours: integer(1, 168), revision
}).refine(value => value.items || value.amount !== undefined, { message: 'Add at least one price item.' });

export function quoteForm(body) {
  if (!body || !Object.hasOwn(body, 'itemName')) return body;
  const columns = ['itemName', 'itemQuantity', 'itemPrice'].map(key => [body[key]].flat());
  if (columns.some(column => column.length !== columns[0].length)) {
    throw new AppError(422, 'INVALID_QUOTE_ITEMS', 'Check the quote items.');
  }
  const items = columns[0].map((name, index) => ({
    name, quantity: columns[1][index], unitPrice: columns[2][index]
  })).filter(row => Object.values(row).some(value => typeof value !== 'string' || value.trim() !== ''));
  return { ...body, items };
}
export const decision = z.object({ version: revision, decision: z.enum(['ACCEPTED', 'REJECTED']) });
export const transition = z.object({
  action: z.enum(['start', 'ready', 'complete', 'cancel']), revision, detail
}).refine(value => value.action !== 'cancel' || value.detail, { message: 'Enter a reason for cancellation.' });
export const preference = z.object({ enabled: bool });

export function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue.path[0];
  throw new AppError(422, 'INVALID_INPUT', field ? `Check the ${field} field and try again.` : issue.message);
}
