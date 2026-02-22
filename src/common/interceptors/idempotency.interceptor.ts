import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionStatus } from '../enums';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'];

    if (!idempotencyKey) {
      return next.handle();
    }

    const existing = await this.transactionRepo.findOne({
      where: { idempotencyKey },
      relations: [
        'ledgerEntries',
        'sourceWallet',
        'sourceWallet.assetType',
        'sourceWallet.user',
        'destinationWallet',
        'destinationWallet.assetType',
        'destinationWallet.user',
      ],
    });

    if (existing) {
      if (existing.status === TransactionStatus.COMPLETED) {
        return of(existing);
      }
      if (existing.status === TransactionStatus.PENDING) {
        throw new ConflictException('Transaction is currently being processed');
      }
      if (existing.status === TransactionStatus.FAILED) {
        throw new UnprocessableEntityException(existing.errorMessage);
      }
    }

    return next.handle();
  }
}
