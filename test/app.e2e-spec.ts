import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { User } from '../src/users/entities/user.entity';
import { AssetType } from '../src/asset-types/entities/asset-type.entity';
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { LedgerEntry } from '../src/transactions/entities/ledger-entry.entity';
import { UserRole, TransactionType, TransactionStatus, EntryType } from '../src/common/enums';
import { v4 as uuidv4 } from 'uuid';

describe('Wallet Service (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let alice: User;
  let bob: User;
  let treasury: User;
  let goldCoins: AssetType;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    dataSource = moduleFixture.get<DataSource>(DataSource);

    // Seed test data
    await seedTestData(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedTestData(ds: DataSource) {
    const qr = ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      // Asset types
      goldCoins = qr.manager.create(AssetType, {
        code: 'GOLD_COINS',
        name: 'Gold Coins',
        description: 'Test currency',
      });
      goldCoins = await qr.manager.save(goldCoins);

      // Users
      treasury = qr.manager.create(User, {
        username: 'treasury',
        email: 'treasury@system.internal',
        role: UserRole.SYSTEM,
      });
      treasury = await qr.manager.save(treasury);

      alice = qr.manager.create(User, {
        username: 'alice',
        email: 'alice@example.com',
        role: UserRole.USER,
      });
      alice = await qr.manager.save(alice);

      bob = qr.manager.create(User, {
        username: 'bob',
        email: 'bob@example.com',
        role: UserRole.USER,
      });
      bob = await qr.manager.save(bob);

      // Wallets
      const treasuryWallet = qr.manager.create(Wallet, {
        userId: treasury.id,
        assetTypeId: goldCoins.id,
        balance: 1000000,
      });
      await qr.manager.save(treasuryWallet);

      const aliceWallet = qr.manager.create(Wallet, {
        userId: alice.id,
        assetTypeId: goldCoins.id,
        balance: 1000,
      });
      await qr.manager.save(aliceWallet);

      const bobWallet = qr.manager.create(Wallet, {
        userId: bob.id,
        assetTypeId: goldCoins.id,
        balance: 500,
      });
      await qr.manager.save(bobWallet);

      await qr.commitTransaction();
    } catch (error) {
      await qr.rollbackTransaction();
      throw error;
    } finally {
      await qr.release();
    }
  }

  describe('GET /api/v1/users', () => {
    it('should return all users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('GET /api/v1/wallets/user/:userId', () => {
    it('should return wallets for a user', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/wallets/user/${alice.id}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(Number(res.body[0].balance)).toBe(1000);
    });
  });

  describe('POST /api/v1/transactions/top-up', () => {
    it('should credit user wallet and debit treasury', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/top-up')
        .set('Idempotency-Key', uuidv4())
        .send({
          userId: alice.id,
          assetTypeCode: 'GOLD_COINS',
          amount: 500,
        })
        .expect(201);

      expect(res.body.status).toBe(TransactionStatus.COMPLETED);
      expect(res.body.type).toBe(TransactionType.TOP_UP);
      expect(Number(res.body.amount)).toBe(500);
      expect(res.body.ledgerEntries).toHaveLength(2);
    });

    it('should reject request without Idempotency-Key', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/top-up')
        .send({
          userId: alice.id,
          assetTypeCode: 'GOLD_COINS',
          amount: 100,
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/transactions/bonus', () => {
    it('should issue bonus credits to user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/bonus')
        .set('Idempotency-Key', uuidv4())
        .send({
          userId: bob.id,
          assetTypeCode: 'GOLD_COINS',
          amount: 100,
          metadata: { reason: 'daily_login' },
        })
        .expect(201);

      expect(res.body.status).toBe(TransactionStatus.COMPLETED);
      expect(res.body.type).toBe(TransactionType.BONUS);
    });
  });

  describe('POST /api/v1/transactions/purchase', () => {
    it('should debit user wallet for purchase', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/transactions/purchase')
        .set('Idempotency-Key', uuidv4())
        .send({
          userId: alice.id,
          assetTypeCode: 'GOLD_COINS',
          amount: 200,
        })
        .expect(201);

      expect(res.body.status).toBe(TransactionStatus.COMPLETED);
      expect(res.body.type).toBe(TransactionType.PURCHASE);
    });

    it('should reject purchase when balance is insufficient', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/transactions/purchase')
        .set('Idempotency-Key', uuidv4())
        .send({
          userId: bob.id,
          assetTypeCode: 'GOLD_COINS',
          amount: 999999,
        })
        .expect(400);
    });
  });

  describe('Idempotency', () => {
    it('should return same result for duplicate idempotency key', async () => {
      const key = uuidv4();
      const payload = {
        userId: alice.id,
        assetTypeCode: 'GOLD_COINS',
        amount: 50,
      };

      const first = await request(app.getHttpServer())
        .post('/api/v1/transactions/top-up')
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/v1/transactions/top-up')
        .set('Idempotency-Key', key)
        .send(payload);

      // Second request should return the same transaction
      expect(first.body.id).toBe(second.body.id);
    });
  });

  describe('Concurrency', () => {
    it('should handle concurrent purchases without overdraft', async () => {
      // Bob has limited Gold Coins. Fire multiple concurrent purchases.
      // Only those with sufficient balance should succeed.
      const walletsBefore = await request(app.getHttpServer())
        .get(`/api/v1/wallets/user/${bob.id}`)
        .expect(200);

      const currentBalance = Number(walletsBefore.body[0].balance);
      const purchaseAmount = Math.floor(currentBalance / 2) + 1;

      // Two concurrent purchases, each requesting more than half the balance
      // Only one should succeed
      const promises = [
        request(app.getHttpServer())
          .post('/api/v1/transactions/purchase')
          .set('Idempotency-Key', uuidv4())
          .send({
            userId: bob.id,
            assetTypeCode: 'GOLD_COINS',
            amount: purchaseAmount,
          }),
        request(app.getHttpServer())
          .post('/api/v1/transactions/purchase')
          .set('Idempotency-Key', uuidv4())
          .send({
            userId: bob.id,
            assetTypeCode: 'GOLD_COINS',
            amount: purchaseAmount,
          }),
      ];

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 400);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
    });
  });

  describe('GET /api/v1/transactions', () => {
    it('should list transactions with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/transactions?page=1&limit=5')
        .expect(200);

      expect(res.body.transactions).toBeInstanceOf(Array);
      expect(typeof res.body.total).toBe('number');
    });

    it('should filter transactions by userId', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions?userId=${alice.id}`)
        .expect(200);

      expect(res.body.transactions).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/v1/asset-types', () => {
    it('should return all asset types', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/asset-types')
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });
});
