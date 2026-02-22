import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  UnprocessableEntityException,
} from '@nestjs/common';
import { of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { TransactionStatus } from '../enums';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let transactionRepo: Record<string, jest.Mock>;

  const mockExecutionContext = (idempotencyKey?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          headers: idempotencyKey
            ? { 'idempotency-key': idempotencyKey }
            : {},
        }),
      }),
    }) as any;

  const mockCallHandler: CallHandler = {
    handle: () => of({ id: 'new-txn', status: 'COMPLETED' }),
  };

  beforeEach(async () => {
    transactionRepo = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionRepo,
        },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
  });

  it('should pass through when no idempotency key is provided', async () => {
    const ctx = mockExecutionContext();
    const result = await interceptor.intercept(ctx, mockCallHandler);

    expect(transactionRepo.findOne).not.toHaveBeenCalled();
    const value = await result.toPromise();
    expect(value).toEqual({ id: 'new-txn', status: 'COMPLETED' });
  });

  it('should pass through when key is new (no existing transaction)', async () => {
    transactionRepo.findOne.mockResolvedValue(null);

    const ctx = mockExecutionContext('new-key');
    const result = await interceptor.intercept(ctx, mockCallHandler);

    const value = await result.toPromise();
    expect(value).toEqual({ id: 'new-txn', status: 'COMPLETED' });
  });

  it('should return cached result for COMPLETED transaction', async () => {
    const completedTxn = {
      id: 'existing-txn',
      status: TransactionStatus.COMPLETED,
      ledgerEntries: [],
    };
    transactionRepo.findOne.mockResolvedValue(completedTxn);

    const ctx = mockExecutionContext('existing-key');
    const result = await interceptor.intercept(ctx, mockCallHandler);

    const value = await result.toPromise();
    expect(value).toEqual(completedTxn);
  });

  it('should throw ConflictException for PENDING transaction', async () => {
    transactionRepo.findOne.mockResolvedValue({
      id: 'pending-txn',
      status: TransactionStatus.PENDING,
    });

    const ctx = mockExecutionContext('pending-key');

    await expect(
      interceptor.intercept(ctx, mockCallHandler),
    ).rejects.toThrow(ConflictException);
  });

  it('should throw UnprocessableEntityException for FAILED transaction', async () => {
    transactionRepo.findOne.mockResolvedValue({
      id: 'failed-txn',
      status: TransactionStatus.FAILED,
      errorMessage: 'Insufficient balance',
    });

    const ctx = mockExecutionContext('failed-key');

    await expect(
      interceptor.intercept(ctx, mockCallHandler),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
