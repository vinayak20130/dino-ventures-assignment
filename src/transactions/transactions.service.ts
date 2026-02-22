import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { Transaction } from './entities/transaction.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletsService } from '../wallets/wallets.service';
import {
  TransactionType,
  TransactionStatus,
  EntryType,
} from '../common/enums';
import { TopUpDto } from './dto/top-up.dto';
import { BonusDto } from './dto/bonus.dto';
import { PurchaseDto } from './dto/purchase.dto';

interface ExecuteTransactionParams {
  idempotencyKey: string;
  type: TransactionType;
  sourceWalletId: string;
  destWalletId: string;
  amount: number;
  referenceId?: string;
  metadata?: Record<string, any>;
  validateSourceBalance: boolean;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    private readonly walletsService: WalletsService,
  ) {}

  async topUp(dto: TopUpDto, idempotencyKey: string): Promise<Transaction> {
    const treasuryWallet = await this.walletsService.findSystemWallet(
      dto.assetTypeCode,
    );
    const userWallet = await this.walletsService.findUserWallet(
      dto.userId,
      dto.assetTypeCode,
    );

    return this.executeTransaction({
      idempotencyKey,
      type: TransactionType.TOP_UP,
      sourceWalletId: treasuryWallet.id,
      destWalletId: userWallet.id,
      amount: dto.amount,
      referenceId: dto.referenceId,
      metadata: dto.metadata,
      validateSourceBalance: false,
    });
  }

  async bonus(dto: BonusDto, idempotencyKey: string): Promise<Transaction> {
    const treasuryWallet = await this.walletsService.findSystemWallet(
      dto.assetTypeCode,
    );
    const userWallet = await this.walletsService.findUserWallet(
      dto.userId,
      dto.assetTypeCode,
    );

    return this.executeTransaction({
      idempotencyKey,
      type: TransactionType.BONUS,
      sourceWalletId: treasuryWallet.id,
      destWalletId: userWallet.id,
      amount: dto.amount,
      metadata: dto.metadata,
      validateSourceBalance: false,
    });
  }

  async purchase(
    dto: PurchaseDto,
    idempotencyKey: string,
  ): Promise<Transaction> {
    const userWallet = await this.walletsService.findUserWallet(
      dto.userId,
      dto.assetTypeCode,
    );
    const treasuryWallet = await this.walletsService.findSystemWallet(
      dto.assetTypeCode,
    );

    return this.executeTransaction({
      idempotencyKey,
      type: TransactionType.PURCHASE,
      sourceWalletId: userWallet.id,
      destWalletId: treasuryWallet.id,
      amount: dto.amount,
      referenceId: dto.referenceId,
      metadata: dto.metadata,
      validateSourceBalance: true,
    });
  }

  async findById(id: string): Promise<Transaction> {
    const transaction = await this.transactionRepo.findOne({
      where: { id },
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
    if (!transaction) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }
    return transaction;
  }

  async findAll(
    userId?: string,
    type?: TransactionType,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const qb = this.transactionRepo
      .createQueryBuilder('txn')
      .leftJoinAndSelect('txn.ledgerEntries', 'entry')
      .leftJoinAndSelect('txn.sourceWallet', 'sw')
      .leftJoinAndSelect('sw.assetType', 'swAt')
      .leftJoinAndSelect('sw.user', 'swUser')
      .leftJoinAndSelect('txn.destinationWallet', 'dw')
      .leftJoinAndSelect('dw.assetType', 'dwAt')
      .leftJoinAndSelect('dw.user', 'dwUser')
      .orderBy('txn.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (userId) {
      qb.andWhere('(sw.user_id = :userId OR dw.user_id = :userId)', {
        userId,
      });
    }

    if (type) {
      qb.andWhere('txn.type = :type', { type });
    }

    const [transactions, total] = await qb.getManyAndCount();
    return { transactions, total };
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Transaction> {
    const transaction = await this.transactionRepo.findOne({
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
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
  }

  /**
   * Core transaction execution engine.
   *
   * 1. INSERT transaction with PENDING status
   * 2. Lock both wallets with SELECT FOR UPDATE (ordered by ID to prevent deadlocks)
   * 3. Validate source balance if required (user purchases)
   * 4. Update wallet balances
   * 5. Create debit + credit ledger entries (double-entry bookkeeping)
   * 6. Mark transaction COMPLETED
   * 7. COMMIT
   */
  private async executeTransaction(
    params: ExecuteTransactionParams,
  ): Promise<Transaction> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      // 1. Create transaction record with PENDING status
      const transaction = queryRunner.manager.create(Transaction, {
        idempotencyKey: params.idempotencyKey,
        type: params.type,
        status: TransactionStatus.PENDING,
        sourceWalletId: params.sourceWalletId,
        destinationWalletId: params.destWalletId,
        amount: params.amount,
        referenceId: params.referenceId,
        metadata: params.metadata || {},
      });

      let savedTransaction: Transaction;
      try {
        savedTransaction = await queryRunner.manager.save(transaction);
      } catch (error: any) {
        // UNIQUE constraint violation on idempotency_key — race condition
        if (error.code === '23505') {
          await queryRunner.rollbackTransaction();
          return this.findByIdempotencyKey(params.idempotencyKey);
        }
        throw error;
      }

      // 2. Lock wallets in deterministic order (ascending UUID) to prevent deadlocks
      const [sourceWallet, destWallet] = await this.lockWalletsInOrder(
        queryRunner,
        params.sourceWalletId,
        params.destWalletId,
      );

      // 3. Validate source balance if required (user spending)
      if (params.validateSourceBalance) {
        const sourceBalance = Number(sourceWallet.balance);
        if (sourceBalance < params.amount) {
          // Rollback so the idempotency key is not consumed — client can retry
          await queryRunner.rollbackTransaction();
          throw new BadRequestException(
            `Insufficient balance. Available: ${sourceBalance}, Required: ${params.amount}`,
          );
        }
      }

      // 4. Calculate new balances
      const newSourceBalance = Number(sourceWallet.balance) - params.amount;
      const newDestBalance = Number(destWallet.balance) + params.amount;

      // 5. Update wallet balances
      await queryRunner.manager.update(Wallet, sourceWallet.id, {
        balance: newSourceBalance,
      });
      await queryRunner.manager.update(Wallet, destWallet.id, {
        balance: newDestBalance,
      });

      // 6. Create ledger entries (double-entry bookkeeping)
      const debitEntry = queryRunner.manager.create(LedgerEntry, {
        transactionId: savedTransaction.id,
        walletId: sourceWallet.id,
        entryType: EntryType.DEBIT,
        amount: params.amount,
        balanceAfter: newSourceBalance,
      });

      const creditEntry = queryRunner.manager.create(LedgerEntry, {
        transactionId: savedTransaction.id,
        walletId: destWallet.id,
        entryType: EntryType.CREDIT,
        amount: params.amount,
        balanceAfter: newDestBalance,
      });

      await queryRunner.manager.save(LedgerEntry, [debitEntry, creditEntry]);

      // 7. Mark transaction as COMPLETED
      savedTransaction.status = TransactionStatus.COMPLETED;
      await queryRunner.manager.save(savedTransaction);

      // 8. COMMIT
      await queryRunner.commitTransaction();

      // Return fully loaded transaction
      return this.findById(savedTransaction.id);
    } catch (error) {
      this.logger.error(
        `Transaction failed [key=${params.idempotencyKey}, type=${params.type}]: ${error instanceof Error ? error.message : error}`,
      );
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Lock wallets in ascending UUID order to prevent deadlocks.
   *
   * If Transaction A locks wallet-1 then wallet-2, and Transaction B also
   * locks wallet-1 then wallet-2 (same order), no deadlock can occur.
   * Without ordering, A could lock 1→2 while B locks 2→1, causing deadlock.
   */
  private async lockWalletsInOrder(
    queryRunner: QueryRunner,
    walletId1: string,
    walletId2: string,
  ): Promise<[Wallet, Wallet]> {
    const [firstId, secondId] =
      walletId1 < walletId2
        ? [walletId1, walletId2]
        : [walletId2, walletId1];

    const first = await queryRunner.manager
      .getRepository(Wallet)
      .createQueryBuilder('wallet')
      .setLock('pessimistic_write')
      .where('wallet.id = :id', { id: firstId })
      .getOne();

    if (!first) {
      throw new NotFoundException(`Wallet ${firstId} not found`);
    }

    const second = await queryRunner.manager
      .getRepository(Wallet)
      .createQueryBuilder('wallet')
      .setLock('pessimistic_write')
      .where('wallet.id = :id', { id: secondId })
      .getOne();

    if (!second) {
      throw new NotFoundException(`Wallet ${secondId} not found`);
    }

    // Return in caller's original order (source, destination)
    return walletId1 < walletId2 ? [first, second] : [second, first];
  }
}
