import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { TransactionType, TransactionStatus } from '../../common/enums';
import { Wallet } from '../../wallets/entities/wallet.entity';
import { LedgerEntry } from './ledger-entry.entity';

@Entity('transactions')
@Index(['sourceWalletId'])
@Index(['destinationWalletId'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 255,
    unique: true,
  })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 20 })
  type: TransactionType;

  @Column({
    type: 'varchar',
    length: 20,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'source_wallet_id' })
  sourceWallet: Wallet;

  @Column({ name: 'source_wallet_id' })
  sourceWalletId: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'dest_wallet_id' })
  destinationWallet: Wallet;

  @Column({ name: 'dest_wallet_id' })
  destinationWalletId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ name: 'reference_id', type: 'varchar', length: 255, nullable: true })
  referenceId: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, any>;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @OneToMany(() => LedgerEntry, (entry) => entry.transaction, { cascade: true })
  ledgerEntries: LedgerEntry[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
