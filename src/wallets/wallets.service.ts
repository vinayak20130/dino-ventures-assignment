import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { LedgerEntry } from '../transactions/entities/ledger-entry.entity';
import { UserRole } from '../common/enums';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(LedgerEntry)
    private readonly ledgerEntryRepo: Repository<LedgerEntry>,
  ) {}

  async findUserWallet(userId: string, assetTypeCode: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findOne({
      where: {
        userId,
        assetType: { code: assetTypeCode },
      },
      relations: ['assetType', 'user'],
    });
    if (!wallet) {
      throw new NotFoundException(
        `Wallet not found for user ${userId} and asset ${assetTypeCode}`,
      );
    }
    return wallet;
  }

  async findSystemWallet(assetTypeCode: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findOne({
      where: {
        user: { role: UserRole.SYSTEM },
        assetType: { code: assetTypeCode },
      },
      relations: ['assetType', 'user'],
    });
    if (!wallet) {
      throw new NotFoundException(
        `System wallet not found for asset ${assetTypeCode}`,
      );
    }
    return wallet;
  }

  async getWalletsByUser(userId: string): Promise<Wallet[]> {
    return this.walletRepo.find({
      where: { userId },
      relations: ['assetType'],
    });
  }

  async getWalletById(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findOne({
      where: { id: walletId },
      relations: ['assetType', 'user'],
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  async getLedgerHistory(
    walletId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ entries: LedgerEntry[]; total: number }> {
    const [entries, total] = await this.ledgerEntryRepo.findAndCount({
      where: { walletId },
      relations: ['transaction'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { entries, total };
  }
}
