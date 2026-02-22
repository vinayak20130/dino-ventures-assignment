import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { Wallet } from './entities/wallet.entity';
import { LedgerEntry } from '../transactions/entities/ledger-entry.entity';
import { UserRole } from '../common/enums';

describe('WalletsService', () => {
  let service: WalletsService;
  let walletRepo: Record<string, jest.Mock>;
  let ledgerEntryRepo: Record<string, jest.Mock>;

  const mockWallet = {
    id: 'wallet-1',
    userId: 'user-1',
    assetTypeId: 'asset-1',
    balance: 1000,
    assetType: { code: 'GOLD_COINS' },
    user: { id: 'user-1', role: UserRole.USER },
  };

  beforeEach(async () => {
    walletRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    ledgerEntryRepo = {
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: getRepositoryToken(Wallet), useValue: walletRepo },
        {
          provide: getRepositoryToken(LedgerEntry),
          useValue: ledgerEntryRepo,
        },
      ],
    }).compile();

    service = module.get<WalletsService>(WalletsService);
  });

  describe('findUserWallet', () => {
    it('should return wallet when found', async () => {
      walletRepo.findOne.mockResolvedValue(mockWallet);

      const result = await service.findUserWallet('user-1', 'GOLD_COINS');

      expect(result).toEqual(mockWallet);
      expect(walletRepo.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', assetType: { code: 'GOLD_COINS' } },
        relations: ['assetType', 'user'],
      });
    });

    it('should throw NotFoundException when wallet not found', async () => {
      walletRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findUserWallet('unknown-user', 'GOLD_COINS'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findSystemWallet', () => {
    it('should find wallet for SYSTEM role user', async () => {
      const systemWallet = {
        ...mockWallet,
        user: { id: 'treasury', role: UserRole.SYSTEM },
      };
      walletRepo.findOne.mockResolvedValue(systemWallet);

      const result = await service.findSystemWallet('GOLD_COINS');

      expect(result.user.role).toBe(UserRole.SYSTEM);
      expect(walletRepo.findOne).toHaveBeenCalledWith({
        where: {
          user: { role: UserRole.SYSTEM },
          assetType: { code: 'GOLD_COINS' },
        },
        relations: ['assetType', 'user'],
      });
    });

    it('should throw NotFoundException when system wallet not found', async () => {
      walletRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findSystemWallet('NONEXISTENT'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWalletsByUser', () => {
    it('should return all wallets for a user', async () => {
      walletRepo.find.mockResolvedValue([mockWallet]);

      const result = await service.getWalletsByUser('user-1');

      expect(result).toHaveLength(1);
      expect(walletRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        relations: ['assetType'],
      });
    });
  });

  describe('getWalletById', () => {
    it('should return wallet when found', async () => {
      walletRepo.findOne.mockResolvedValue(mockWallet);

      const result = await service.getWalletById('wallet-1');
      expect(result.id).toBe('wallet-1');
    });

    it('should throw NotFoundException when not found', async () => {
      walletRepo.findOne.mockResolvedValue(null);

      await expect(service.getWalletById('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getLedgerHistory', () => {
    it('should return paginated ledger entries', async () => {
      const entries = [
        { id: 'entry-1', entryType: 'CREDIT', amount: 100 },
      ];
      ledgerEntryRepo.findAndCount.mockResolvedValue([entries, 1]);

      const result = await service.getLedgerHistory('wallet-1', 1, 20);

      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(ledgerEntryRepo.findAndCount).toHaveBeenCalledWith({
        where: { walletId: 'wallet-1' },
        relations: ['transaction'],
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('should correctly calculate skip for page 2', async () => {
      ledgerEntryRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getLedgerHistory('wallet-1', 2, 10);

      expect(ledgerEntryRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });
  });
});
