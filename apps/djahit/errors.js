export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function found(row) {
  if (!row) throw new AppError(404, 'NOT_FOUND', 'This record is unavailable.');
  return row;
}

export function conflict(message) {
  throw new AppError(409, 'CONFLICT', message);
}
