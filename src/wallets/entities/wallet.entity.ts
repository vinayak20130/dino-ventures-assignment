import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AssetType } from '../../asset-types/entities/asset-type.entity';
import { LedgerEntry } from '../../transactions/entities/ledger-entry.entity';

@Entity('wallets')
@Unique(['userId', 'assetTypeId'])
@Index(['userId'])
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.wallets)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => AssetType)
  @JoinColumn({ name: 'asset_type_id' })
  assetType: AssetType;

  @Column({ name: 'asset_type_id' })
  assetTypeId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  balance: number;

  @OneToMany(() => LedgerEntry, (entry) => entry.wallet)
  ledgerEntries: LedgerEntry[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
