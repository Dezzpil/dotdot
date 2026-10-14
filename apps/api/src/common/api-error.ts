import { HttpException } from '@nestjs/common';

/** Machine-readable error codes; the web app maps them to friendly RU/EN texts. */
export type ErrorCode =
  | 'NO_FILE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'BAD_OPTIONS'
  | 'BAD_IMAGE'
  | 'BUSY'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'NOT_READY'
  | 'TIMEOUT'
  | 'INTERNAL';

export class ApiError extends HttpException {
  constructor(status: number, code: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super({ error: { code, message, ...extra } }, status);
  }
}
