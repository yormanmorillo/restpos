export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message = 'No se encontró el recurso.') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message, details) =>
  new AppError(409, 'CONFLICT', message, details);

export const unprocessable = (message, details) =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', message, details);

export const validationError = (message = 'Revisa los datos enviados.', details) =>
  new AppError(422, 'VALIDATION_ERROR', message, details);

export function zodToValidationError(error) {
  const fields = error.issues.map((issue) => ({
    path: issue.path.reduce((acc, part) => {
      if (typeof part === 'number') return `${acc}[${part}]`;
      return acc ? `${acc}.${part}` : String(part);
    }, ''),
    message: issue.message,
  }));
  return validationError('Revisa los datos enviados.', { fields });
}
