# Internal Wallet Service

A high-integrity wallet service for managing virtual currencies (Gold Coins, Diamonds, Loyalty Points) in a gaming/loyalty platform. Built with NestJS, TypeORM, and PostgreSQL.

## Tech Stack & Rationale

| Technology | Why |
|-----------|-----|
| **NestJS** | Modular architecture, built-in DI, interceptors for cross-cutting concerns (idempotency), first-class TypeScript support |
| **TypeORM** | Tight NestJS integration via `@nestjs/typeorm`, `QueryRunner` for granular transaction control, `pessimistic_write` lock mode maps to `SELECT FOR UPDATE` |
| **PostgreSQL** | ACID transactions, row-level locking (`SELECT FOR UPDATE`), `DECIMAL` type for precise currency arithmetic, `JSONB` for flexible metadata |
| **Docker Compose** | One-command database setup, reproducible environment |

## Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- npm

### Option A: Docker (recommended)

```bash
docker compose up --build
```

This automatically starts PostgreSQL, seeds the database, and launches the app. The API is available at `http://localhost:3000/api/v1`

### Option B: Local development

#### 1. Start the database

```bash
docker compose up postgres -d
```

> **Note**: The Docker container maps PostgreSQL to host port **5433** (to avoid conflicts with any native PostgreSQL on 5432). The `.env` file is pre-configured to match.

#### 2. Install dependencies

```bash
npm install
```

#### 3. Run the seed script

```bash
npm run seed
```

This creates:
- **3 Asset Types**: Gold Coins, Diamonds, Loyalty Points
- **1 System Account**: Treasury (counterparty for all transactions)
- **2 Users**: Alice (1000 Gold, 500 Diamonds, 200 Loyalty) and Bob (500 Gold, 100 Diamonds, 50 Loyalty)
- All initial balances are established via proper double-entry ledger transactions

#### 4. Start the server

```bash
npm run start:dev
```

The API is available at `http://localhost:3000/api/v1`

## API Endpoints

### Transactions (require `Idempotency-Key` header)

```bash
# Top-up: credit user wallet (simulates real money purchase)
POST /api/v1/transactions/top-up
{
  "userId": "<uuid>",
  "assetTypeCode": "GOLD_COINS",
  "amount": 500,
  "referenceId": "payment-ref-123"
}

# Bonus: system issues free credits
POST /api/v1/transactions/bonus
{
  "userId": "<uuid>",
  "assetTypeCode": "DIAMONDS",
  "amount": 50,
  "metadata": { "reason": "daily_login_bonus" }
}

# Purchase: user spends credits
POST /api/v1/transactions/purchase
{
  "userId": "<uuid>",
  "assetTypeCode": "LOYALTY_POINTS",
  "amount": 100,
  "referenceId": "shop-item-456"
}

# Get transaction by ID
GET /api/v1/transactions/:id

# List transactions (with optional filters)
GET /api/v1/transactions?userId=<uuid>&type=TOP_UP&page=1&limit=20
```

### Wallets

```bash
# Get all wallets for a user
GET /api/v1/wallets/user/:userId

# Get single wallet
GET /api/v1/wallets/:walletId

# Get ledger history for a wallet
GET /api/v1/wallets/:walletId/ledger?page=1&limit=20
```

### Users & Asset Types

```bash
GET /api/v1/users
GET /api/v1/users/:id
GET /api/v1/asset-types
```

## Example: Full Flow

```bash
# 1. List users to get Alice's ID
curl http://localhost:3000/api/v1/users

# 2. Check Alice's wallets
curl http://localhost:3000/api/v1/wallets/user/<alice-uuid>

# 3. Top up Alice with 500 Gold Coins
curl -X POST http://localhost:3000/api/v1/transactions/top-up \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"userId":"<alice-uuid>","assetTypeCode":"GOLD_COINS","amount":500}'

# 4. Alice purchases an item for 200 Gold Coins
curl -X POST http://localhost:3000/api/v1/transactions/purchase \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"userId":"<alice-uuid>","assetTypeCode":"GOLD_COINS","amount":200}'

# 5. Verify balance
curl http://localhost:3000/api/v1/wallets/user/<alice-uuid>
```

## Concurrency Strategy

### Problem
In a high-traffic system, multiple transactions can hit the same wallet simultaneously. Without protection:
- Two purchases of 300 from a 500-balance wallet could both succeed (reading 500, both writing 200), overdrafting the account.

### Solution: Pessimistic Locking with `SELECT FOR UPDATE`

Every transaction acquires an **exclusive row lock** on both involved wallets before reading or modifying balances:

```sql
SELECT * FROM wallets WHERE id = $1 FOR UPDATE
```

This ensures that concurrent transactions on the same wallet are **serialized** — the second transaction blocks until the first commits, then sees the updated balance.

**Implementation**: TypeORM's `pessimistic_write` lock mode:
```typescript
queryRunner.manager
  .getRepository(Wallet)
  .createQueryBuilder('wallet')
  .setLock('pessimistic_write')  // SELECT ... FOR UPDATE
  .where('wallet.id = :id', { id })
  .getOne();
```

### Deadlock Prevention

When a transaction involves two wallets (source and destination), locks are always acquired in **ascending UUID order**, regardless of which is source and which is destination. This eliminates deadlock potential because all transactions follow the same ordering.

### Transaction Isolation

`READ COMMITTED` (PostgreSQL default) is used. Combined with `SELECT FOR UPDATE`, this provides sufficient isolation without the overhead and retry complexity of `SERIALIZABLE`.

## Idempotency Strategy

### Problem
Network failures, client retries, and load balancer timeouts can cause the same request to be sent multiple times. Without idempotency, a user could be charged twice for the same top-up.

### Solution: Three-Layer Defense

1. **`Idempotency-Key` header** (required on all POST endpoints): Clients provide a unique key per logical operation.

2. **NestJS Interceptor**: Before processing, checks if a transaction with this key already exists:
   - `COMPLETED` → returns the cached result
   - `PENDING` → returns 409 Conflict
   - `FAILED` → returns the cached error

3. **Database UNIQUE constraint**: On `transactions.idempotency_key`. Even if two identical requests race past the interceptor simultaneously, the INSERT-level unique constraint catches the duplicate. The service catches PostgreSQL error code `23505` and returns the winning transaction.

## Data Integrity

### Double-Entry Bookkeeping
Every transaction creates exactly two ledger entries:
- **DEBIT** on the source wallet (balance decreases)
- **CREDIT** on the destination wallet (balance increases)

The sum of all ledger entries across all wallets always equals zero. Each entry records a `balance_after` snapshot for audit trail reconstruction.

### Balance Validation
- **User wallets**: Balance checked after acquiring the lock (sufficient funds for purchases)
- **Treasury wallet**: Allowed to go negative (it is the source of all virtual currency)
- **DECIMAL(18,4)**: No floating-point errors in balance arithmetic

## Testing

```bash
# Unit tests
npm test

# E2E tests (requires running PostgreSQL)
npm run test:e2e
```

The E2E test suite covers:
- All three transaction flows (top-up, bonus, purchase)
- Insufficient balance rejection
- Idempotency (duplicate key returns same result)
- Concurrency (parallel purchases don't overdraft)
- API pagination and filtering

## Database Schema

```
users           → id, username, email, role (USER|SYSTEM)
asset_types     → id, code, name, description
wallets         → id, user_id, asset_type_id, balance  [UNIQUE(user_id, asset_type_id)]
transactions    → id, idempotency_key (UNIQUE), type, status, source/dest wallet, amount
ledger_entries  → id, transaction_id, wallet_id, entry_type (DEBIT|CREDIT), amount, balance_after
```

## Project Structure

```
src/
├── main.ts                         # App bootstrap
├── app.module.ts                   # Root module
├── config/
│   └── database.config.ts          # TypeORM config
├── common/
│   ├── enums/                      # TransactionType, Status, EntryType, UserRole
│   ├── decorators/                 # @IdempotencyKey()
│   ├── interceptors/               # IdempotencyInterceptor
│   └── filters/                    # AllExceptionsFilter
├── users/                          # User entity, service, controller
├── asset-types/                    # AssetType entity, service, controller
├── wallets/                        # Wallet entity, service, controller
├── transactions/                   # Transaction + LedgerEntry entities, service, controller
└── seed/                           # Seed script (npm run seed)
```
