import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  BeforeUpdate,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { EntryType } from '../../common/enums';
import { Transaction } from './transaction.entity';
import { Wallet } from '../../wallets/entities/wallet.entity';

@Entity('ledger_entries')
@Index(['walletId'])
@Index(['transactionId'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Transaction, (txn) => txn.ledgerEntries)
  @JoinColumn({ name: 'transaction_id' })
  transaction: Transaction;

  @Column({ name: 'transaction_id' })
  transactionId: string;

  @ManyToOne(() => Wallet, (wallet) => wallet.ledgerEntries)
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @Column({ name: 'wallet_id' })
  walletId: string;

  @Column({ name: 'entry_type', type: 'varchar', length: 10 })
  entryType: EntryType;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'balance_after', type: 'decimal', precision: 18, scale: 4 })
  balanceAfter: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Ledger entries are immutable and cannot be modified');
  }
}
