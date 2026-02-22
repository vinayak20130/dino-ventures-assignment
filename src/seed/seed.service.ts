import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AssetType } from '../asset-types/entities/asset-type.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { LedgerEntry } from '../transactions/entities/ledger-entry.entity';
import {
  UserRole,
  TransactionType,
  TransactionStatus,
  EntryType,
} from '../common/enums';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      this.logger.log('Seeding database...');

      // 1. Create asset types
      const assetTypesData = [
        {
          code: 'GOLD_COINS',
          name: 'Gold Coins',
          description: 'Main premium currency earned and spent in-game',
        },
        {
          code: 'DIAMONDS',
          name: 'Diamonds',
          description: 'Rare premium currency for exclusive items',
        },
        {
          code: 'LOYALTY_POINTS',
          name: 'Loyalty Points',
          description: 'Earned through gameplay activity and daily logins',
        },
      ];

      const assetTypes: AssetType[] = [];
      for (const data of assetTypesData) {
        const existing = await queryRunner.manager.findOne(AssetType, {
          where: { code: data.code },
        });
        if (existing) {
          assetTypes.push(existing);
          this.logger.log(`Asset type "${data.code}" already exists, skipping`);
        } else {
          const assetType = queryRunner.manager.create(AssetType, data);
          assetTypes.push(await queryRunner.manager.save(assetType));
          this.logger.log(`Created asset type: ${data.code}`);
        }
      }

      // 2. Create system (treasury) user
      let treasury = await queryRunner.manager.findOne(User, {
        where: { username: 'treasury' },
      });
      if (!treasury) {
        treasury = queryRunner.manager.create(User, {
          username: 'treasury',
          email: 'treasury@system.internal',
          role: UserRole.SYSTEM,
        });
        treasury = await queryRunner.manager.save(treasury);
        this.logger.log('Created treasury system account');
      } else {
        this.logger.log('Treasury account already exists, skipping');
      }

      // 3. Create regular users
      const usersData = [
        { username: 'alice', email: 'alice@example.com' },
        { username: 'bob', email: 'bob@example.com' },
      ];

      const users: User[] = [];
      for (const data of usersData) {
        let user = await queryRunner.manager.findOne(User, {
          where: { username: data.username },
        });
        if (!user) {
          user = queryRunner.manager.create(User, {
            ...data,
            role: UserRole.USER,
          });
          user = await queryRunner.manager.save(user);
          this.logger.log(`Created user: ${data.username}`);
        } else {
          this.logger.log(`User "${data.username}" already exists, skipping`);
        }
        users.push(user);
      }

      const [alice, bob] = users;

      // 4. Create wallets for treasury and fund via genesis transaction
      const treasuryWallets: Record<string, Wallet> = {};
      for (const assetType of assetTypes) {
        let wallet = await queryRunner.manager.findOne(Wallet, {
          where: { userId: treasury.id, assetTypeId: assetType.id },
        });
        if (!wallet) {
          wallet = queryRunner.manager.create(Wallet, {
            userId: treasury.id,
            assetTypeId: assetType.id,
            balance: 0,
          });
          wallet = await queryRunner.manager.save(wallet);
        }

        const genesisKey = `genesis-treasury-${assetType.code}`;
        const existingGenesis = await queryRunner.manager.findOne(Transaction, {
          where: { idempotencyKey: genesisKey },
        });

        if (!existingGenesis) {
          const genesisAmount = 1000000;
          const genesisTxn = queryRunner.manager.create(Transaction, {
            idempotencyKey: genesisKey,
            type: TransactionType.TOP_UP,
            status: TransactionStatus.COMPLETED,
            sourceWalletId: wallet.id,
            destinationWalletId: wallet.id,
            amount: genesisAmount,
            metadata: { reason: 'genesis_mint' },
          });
          const savedGenesis = await queryRunner.manager.save(genesisTxn);

          const newBalance = Number(wallet.balance) + genesisAmount;
          await queryRunner.manager.update(Wallet, wallet.id, {
            balance: newBalance,
          });
          wallet.balance = newBalance;

          const creditEntry = queryRunner.manager.create(LedgerEntry, {
            transactionId: savedGenesis.id,
            walletId: wallet.id,
            entryType: EntryType.CREDIT,
            amount: genesisAmount,
            balanceAfter: newBalance,
          });
          await queryRunner.manager.save(LedgerEntry, [creditEntry]);

          this.logger.log(
            `Genesis: minted ${genesisAmount} ${assetType.code} to treasury`,
          );
        }

        treasuryWallets[assetType.code] = wallet;
      }

      // 5. Create wallets for users and fund them via proper transactions
      const initialBalances: Record<string, Record<string, number>> = {
        alice: { GOLD_COINS: 1000, DIAMONDS: 500, LOYALTY_POINTS: 200 },
        bob: { GOLD_COINS: 500, DIAMONDS: 100, LOYALTY_POINTS: 50 },
      };

      for (const user of users) {
        const balances = initialBalances[user.username];
        for (const assetType of assetTypes) {
          let wallet = await queryRunner.manager.findOne(Wallet, {
            where: { userId: user.id, assetTypeId: assetType.id },
          });
          if (!wallet) {
            wallet = queryRunner.manager.create(Wallet, {
              userId: user.id,
              assetTypeId: assetType.id,
              balance: 0,
            });
            wallet = await queryRunner.manager.save(wallet);
          }

          const amount = balances[assetType.code];
          const idempotencyKey = `seed-${user.username}-${assetType.code}`;

          // Check if this seed transaction already exists
          const existingTxn = await queryRunner.manager.findOne(Transaction, {
            where: { idempotencyKey },
          });
          if (existingTxn) {
            this.logger.log(
              `Seed transaction for ${user.username}/${assetType.code} already exists, skipping`,
            );
            continue;
          }

          // Create the funding transaction (treasury → user)
          const treasuryWallet = treasuryWallets[assetType.code];

          const transaction = queryRunner.manager.create(Transaction, {
            idempotencyKey,
            type: TransactionType.TOP_UP,
            status: TransactionStatus.COMPLETED,
            sourceWalletId: treasuryWallet.id,
            destinationWalletId: wallet.id,
            amount,
            metadata: { reason: 'initial_seed' },
          });
          const savedTxn = await queryRunner.manager.save(transaction);

          // Update balances
          const newTreasuryBalance =
            Number(treasuryWallet.balance) - amount;
          const newUserBalance = Number(wallet.balance) + amount;

          await queryRunner.manager.update(Wallet, treasuryWallet.id, {
            balance: newTreasuryBalance,
          });
          await queryRunner.manager.update(Wallet, wallet.id, {
            balance: newUserBalance,
          });

          // Update local references
          treasuryWallet.balance = newTreasuryBalance;
          wallet.balance = newUserBalance;

          // Create ledger entries
          const debitEntry = queryRunner.manager.create(LedgerEntry, {
            transactionId: savedTxn.id,
            walletId: treasuryWallet.id,
            entryType: EntryType.DEBIT,
            amount,
            balanceAfter: newTreasuryBalance,
          });

          const creditEntry = queryRunner.manager.create(LedgerEntry, {
            transactionId: savedTxn.id,
            walletId: wallet.id,
            entryType: EntryType.CREDIT,
            amount,
            balanceAfter: newUserBalance,
          });

          await queryRunner.manager.save(LedgerEntry, [
            debitEntry,
            creditEntry,
          ]);

          this.logger.log(
            `Funded ${user.username} with ${amount} ${assetType.code}`,
          );
        }
      }

      await queryRunner.commitTransaction();
      this.logger.log('Database seeded successfully!');
      this.logger.log('');
      this.logger.log('=== Seed Summary ===');
      this.logger.log('Asset Types: GOLD_COINS, DIAMONDS, LOYALTY_POINTS');
      this.logger.log('System Account: treasury');
      this.logger.log(
        'Alice: 1000 Gold, 500 Diamonds, 200 Loyalty Points',
      );
      this.logger.log(
        'Bob: 500 Gold, 100 Diamonds, 50 Loyalty Points',
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Seed failed', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
