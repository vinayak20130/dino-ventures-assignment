import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exception.message;
    } else if (exception instanceof QueryFailedError) {
      const dbError = exception as any;
      this.logger.error(
        `Database error [${dbError.code}]: ${exception.message}`,
      );

      if (dbError.code === '23505') {
        status = HttpStatus.CONFLICT;
        message = 'Resource already exists';
      } else if (dbError.code === '23503') {
        status = HttpStatus.BAD_REQUEST;
        message = 'Referenced resource does not exist';
      } else if (dbError.code === '40P01') {
        status = HttpStatus.CONFLICT;
        message = 'Transaction conflict, please retry';
      } else {
        message = 'Database error';
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
