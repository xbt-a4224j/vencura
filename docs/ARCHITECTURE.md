# VenCura — Architecture

How the system is wired and how the two correctness-critical paths (a send under concurrency, and key
custody) actually work. For *where* it runs see [DEPLOYMENT.md](DEPLOYMENT.md); for the threat model see
[SECURITY.md](SECURITY.md).

**Core principle:** the chain is the source of truth; Postgres is a derived, cached projection. Sends validate
against live chain state (nonce + balance), never the cache.

## System architecture

```mermaid
graph TD
    Browser["React Admin\n(packages/web)\nlocalhost:5173"]

    subgraph API["NestJS API (packages/api) — localhost:3000"]
        AuthM["AuthModule\nJWT guard · register · login"]
        WalletsM["WalletsModule\nPOST /wallets\nGET /wallets"]
        TxM["TransactionsModule\nPOST /wallets/:id/transactions\nPOST /wallets/:id/messages\nGET /wallets/:id/transactions\n+ ConfirmationWatcher (poller)"]
        BalM["BalancesModule\nGET /wallets/:id/balance\n+ BalanceRefresher (poller)"]
        SignerM["SignerModule\nEncryptedKeySigner (AES-256-GCM)\nShamirSigner (bonus)"]
        AdminM["AdminModule\nPOST /admin/reset · seed\nconcurrency demo"]

        subgraph Infra["Infra modules"]
            PrismaM["PrismaModule\nPostgres via Prisma ORM"]
            ChainM["ChainModule\nviem client"]
            LockM["LockModule\npg_advisory_xact_lock\n(Lock interface)"]
        end
    end

    subgraph Storage["Data layer"]
        PG[("Postgres\nderived cache\nwallet_balances · transactions\nwallet · users")]
    end

    subgraph Chain["Ethereum"]
        AnvilSepolia["anvil (local dev)\nor Sepolia (deploy)\nchain is source of truth"]
    end

    Browser -->|REST + JWT| AuthM
    Browser -->|REST + JWT| WalletsM
    Browser -->|REST + JWT| TxM
    Browser -->|REST + JWT| BalM
    Browser -->|REST + JWT| AdminM

    WalletsM --> SignerM
    TxM --> SignerM
    TxM --> LockM

    PrismaM --> PG
    ChainM --> AnvilSepolia
    BalM -->|"confirmed balance\n(cache miss → live fetch)"| ChainM
    TxM -->|"live nonce + balance\n(never the cache)"| ChainM
    TxM --> PrismaM
    BalM --> PrismaM
    WalletsM --> PrismaM
    AuthM --> PrismaM
    LockM --> PrismaM
```

## sendTransaction — sequence with nonce lock

```mermaid
sequenceDiagram
    participant C as Client
    participant Ctrl as TransactionsController
    participant Svc as TransactionsService
    participant Lock as LockModule<br/>(pg_advisory_xact_lock)
    participant Signer as Signer<br/>(EncryptedKeySigner)
    participant Chain as Chain (viem)
    participant DB as Postgres

    C->>Ctrl: POST /wallets/:id/transactions {to, amount, idempotencyKey}
    Ctrl->>Svc: sendTransaction(walletId, dto)
    Svc->>Lock: withWalletLock(walletId, fn)

    Note over Lock: pg_advisory_xact_lock — concurrent same-wallet sends queue here

    Lock->>Chain: eth_getTransactionCount("pending") — live, never cached
    Chain-->>Lock: nonce
    Lock->>Signer: signTransaction {to, value, nonce}
    Note over Signer: decrypt in memory · sign · zeroize
    Signer-->>Lock: signedTx
    Lock->>Chain: sendRawTransaction(signedTx)
    Chain-->>Lock: txHash
    Lock->>DB: INSERT {hash, nonce, status=pending, idempotencyKey UNIQUE}
    Note over DB: duplicate key → return existing row, no double-send
    Lock-->>Svc: commit (releases advisory lock)
    Svc-->>C: 202 {hash, status: pending}

    loop ConfirmationWatcher @12s
        DB->>Chain: getTransactionReceipt(hash)
        Chain-->>DB: receipt or null
        DB->>DB: confirmations ≥ threshold → status=confirmed/failed
    end
```

## Key custody — AES-256-GCM at rest

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Generated : generatePrivateKey()
    Generated --> Encrypted : AES-256-GCM(MASTER_KEY)
    Encrypted --> AtRest : store {encryptedKey · iv · authTag}

    AtRest --> InMemory : decrypt(MASTER_KEY) — sign time only
    InMemory --> Signed : signTx / signMessage
    Signed --> Zeroized : zeroize key bytes
    Zeroized --> AtRest : key dropped from process

    note right of InMemory
        plaintext key exists only
        in-process, never persisted,
        never logged, never returned
    end note
```
