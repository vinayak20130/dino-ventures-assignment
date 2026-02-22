import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { Transaction } from './entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import {
  TransactionType,
  TransactionStatus,
  EntryType,
} from '../common/enums';

describe('TransactionsService', () => {
  let service: TransactionsService;
  let walletsService: any;
  let transactionRepo: Record<string, jest.Mock>;
  let mockQueryRunner: any;
  let mockDataSource: any;

  const treasuryWallet = {
    id: 'aaaa-aaaa',
    userId: 'treasury-id',
    balance: 1000000,
  };

  const userWallet = {
    id: 'bbbb-bbbb',
    userId: 'user-id',
    balance: 500,
  };

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      isTransactionActive: true,
      manager: {
        create: jest.fn((entity, data) => ({ ...data })),
        save: jest.fn((entityOrData, data?) => {
          const d = data ?? entityOrData;
          return Array.isArray(d)
            ? d.map((item) => ({ id: 'generated-id', ...item }))
            : { id: 'generated-id', ...d };
        }),
        update: jest.fn(),
        getRepository: jest.fn().mockReturnValue({
          createQueryBuilder: jest.fn().mockReturnValue({
            setLock: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn(),
          }),
        }),
      },
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    walletsService = {
      findSystemWallet: jest.fn(),
      findUserWallet: jest.fn(),
    };

    transactionRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: DataSource, useValue: mockDataSource },
        {
          provide: getRepositoryToken(Transaction),
          useValue: transactionRepo,
        },
        { provide: WalletsService, useValue: walletsService },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
  });

  describe('topUp', () => {
    it('should find treasury and user wallets and execute transaction', async () => {
      walletsService.findSystemWallet.mockResolvedValue(treasuryWallet as any);
      walletsService.findUserWallet.mockResolvedValue(userWallet as any);

      // Mock wallet locking — return wallets in ascending UUID order
      const qbGetOne = mockQueryRunner.manager.getRepository().createQueryBuilder().getOne;
      qbGetOne
        .mockResolvedValueOnce({ ...treasuryWallet }) // aaaa first (ascending)
        .mockResolvedValueOnce({ ...userWallet });

      // Mock findById for the final return
      transactionRepo.findOne.mockResolvedValue({
        id: 'generated-id',
        status: TransactionStatus.COMPLETED,
        type: TransactionType.TOP_UP,
        ledgerEntries: [],
      });

      const result = await service.topUp(
        { userId: 'user-id', assetTypeCode: 'GOLD_COINS', amount: 100 },
        'idem-key-1',
      );

      expect(walletsService.findSystemWallet).toHaveBeenCalledWith('GOLD_COINS');
      expect(walletsService.findUserWallet).toHaveBeenCalledWith(
        'user-id',
        'GOLD_COINS',
      );
      expect(mockQueryRunner.startTransaction).toHaveBeenCalledWith(
        'READ COMMITTED',
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(result.status).toBe(TransactionStatus.COMPLETED);
    });
  });

  describe('purchase', () => {
    it('should reject purchase with insufficient balance', async () => {
      walletsService.findUserWallet.mockResolvedValue({
        ...userWallet,
        balance: 50,
      } as any);
      walletsService.findSystemWallet.mockResolvedValue(treasuryWallet as any);

      // Lock order is ascending UUID: aaaa (treasury) first, then bbbb (user)
      const qbGetOne = mockQueryRunner.manager.getRepository().createQueryBuilder().getOne;
      qbGetOne
        .mockResolvedValueOnce({ ...treasuryWallet })
        .mockResolvedValueOnce({ ...userWallet, balance: 50 });

      await expect(
        service.purchase(
          { userId: 'user-id', assetTypeCode: 'GOLD_COINS', amount: 999 },
          'idem-key-2',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should succeed when balance is sufficient', async () => {
      walletsService.findUserWallet.mockResolvedValue(userWallet as any);
      walletsService.findSystemWallet.mockResolvedValue(treasuryWallet as any);

      const qbGetOne = mockQueryRunner.manager.getRepository().createQueryBuilder().getOne;
      qbGetOne
        .mockResolvedValueOnce({ ...treasuryWallet })
        .mockResolvedValueOnce({ ...userWallet });

      transactionRepo.findOne.mockResolvedValue({
        id: 'generated-id',
        status: TransactionStatus.COMPLETED,
        type: TransactionType.PURCHASE,
        ledgerEntries: [],
      });

      const result = await service.purchase(
        { userId: 'user-id', assetTypeCode: 'GOLD_COINS', amount: 200 },
        'idem-key-3',
      );

      expect(result.status).toBe(TransactionStatus.COMPLETED);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('bonus', () => {
    it('should issue bonus credits without balance validation', async () => {
      walletsService.findSystemWallet.mockResolvedValue(treasuryWallet as any);
      walletsService.findUserWallet.mockResolvedValue(userWallet as any);

      const qbGetOne = mockQueryRunner.manager.getRepository().createQueryBuilder().getOne;
      qbGetOne
        .mockResolvedValueOnce({ ...treasuryWallet })
        .mockResolvedValueOnce({ ...userWallet });

      transactionRepo.findOne.mockResolvedValue({
        id: 'generated-id',
        status: TransactionStatus.COMPLETED,
        type: TransactionType.BONUS,
        ledgerEntries: [],
      });

      const result = await service.bonus(
        {
          userId: 'user-id',
          assetTypeCode: 'GOLD_COINS',
          amount: 100,
          metadata: { reason: 'referral' },
        },
        'idem-key-4',
      );

      expect(result.status).toBe(TransactionStatus.COMPLETED);
    });
  });

  describe('idempotency (23505 handling)', () => {
    it('should return existing transaction on duplicate key', async () => {
      walletsService.findSystemWallet.mockResolvedValue(treasuryWallet as any);
      walletsService.findUserWallet.mockResolvedValue(userWallet as any);

      // Simulate UNIQUE violation on insert
      mockQueryRunner.manager.save = jest.fn().mockRejectedValueOnce({
        code: '23505',
      });

      const existingTxn = {
        id: 'existing-id',
        status: TransactionStatus.COMPLETED,
        idempotencyKey: 'dup-key',
      };
      transactionRepo.findOne.mockResolvedValue(existingTxn);

      const result = await service.topUp(
        { userId: 'user-id', assetTypeCode: 'GOLD_COINS', amount: 100 },
        'dup-key',
      );

      expect(result.id).toBe('existing-id');
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should throw NotFoundException for unknown id', async () => {
      transactionRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return transaction with relations', async () => {
      const txn = { id: 'txn-1', ledgerEntries: [] };
      transactionRepo.findOne.mockResolvedValue(txn);

      const result = await service.findById('txn-1');
      expect(result.id).toBe('txn-1');
    });
  });

  describe('findAll', () => {
    it('should return paginated transactions', async () => {
      const result = await service.findAll(undefined, undefined, 1, 20);
      expect(result).toEqual({ transactions: [], total: 0 });
    });
  });
});
