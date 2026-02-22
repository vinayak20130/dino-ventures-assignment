import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';

export const IdempotencyKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'];
    if (!key) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return key;
  },
);
