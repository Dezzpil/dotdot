import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Every error leaves the API as {"error": {"code", "message"}}. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
        res.status(status).json(body);
        return;
      }
      const code =
        status === HttpStatus.PAYLOAD_TOO_LARGE
          ? 'FILE_TOO_LARGE'
          : status === HttpStatus.NOT_FOUND
            ? 'NOT_FOUND'
            : status === HttpStatus.TOO_MANY_REQUESTS
              ? 'RATE_LIMITED'
              : status === HttpStatus.BAD_REQUEST
                ? 'BAD_OPTIONS'
                : status >= 500
                  ? 'INTERNAL'
                  : 'BAD_OPTIONS';
      const message = Array.isArray(body?.message) ? body.message.join('; ') : (body?.message ?? exception.message);
      res.status(status).json({ error: { code, message } });
      return;
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  }
}
