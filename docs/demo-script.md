# VenCura — Demo Script

**App:** https://vencura-alpha.vercel.app
**Admin:** `admin@vencura.local` / `demo-password` (auto-loads in the Admin view) · **Admin key:** the deploy's `ADMIN_API_KEY` (for seed / reset / create-account)
**Funded admin wallet:** `0x547d…0D42` · **Demo token:** `VCD` at `0x3870…872b`

> **Model reminders:** one account = one wallet · register-if-none / login-after (no picker; the admin is **not** a user) · **no auto-refresh — click Refresh** · recipients are a pasted `0x` address · the logo (◆ VenCura) links Home.

Legend per step: **Do → confirms: requirement.**

## 0. Clean slate (recommended)
1. **Admin** tile → **Settings** → paste the admin key → **Start over (reset all)**. Reseeds just the funded admin wallet; the `VCD` token survives the reset. The User tile now shows **Register** and the User view is genuinely empty (admin doesn't count as a user).

## A. User experience
2. **User** tile → **Register** (email + password **≥ 4 chars**) → you're in. *(Later visits show **Log in** for that one account — registration closes after the first.)* — *create account/wallet; single-user model*
3. Your wallet shows **available == confirmed** (no gas reserve). It's master-funded ~0.001 ETH for gas. — *getBalance*
4. **Send:** paste a recipient `0x…` + an amount → **Send**. Click **Refresh** → the row goes **PENDING → CONFIRMED** (~15–30 s; the confirmation watcher runs server-side, you pull the result with Refresh). — *sendTransaction; on-chain history*
5. **Sign a message** → **Verify** → "✓ verified — recovered 0x… = this wallet." — *signMessage + ecrecover round-trip*

## B. ERC-20 approve / transferFrom (the custody story)
6. **Admin → Token tab → "1 · Distribute to a holder":** paste the **User's wallet address** + an amount → **Send tokens** (admin `transfer`s VCD from its supply). *(To deploy fresh: pick the funded wallet → Deploy demo token.)*
7. **User → "Demo token" panel:** enter an amount → **Approve admin** (`approve(admin, amount)`; the wallet has gas). Hit **refresh** to see the VCD balance. — *ERC-20; contract write*
8. **Admin → Token tab → "2 · transferFrom":** paste the holder (user) address + amount → **transferFrom → admin** (only possible *because* the user approved). **Read allowance** → watch it decrement. — *the on-chain allowance is the gate*

## C. Admin console (6 tabs)
9. **Overview** (summary tiles + recent activity) · **Wallets** (the funded wallet: Send / Concurrency / Sign) · **Token** (the flow above) · **Activity** — **Audit log** (filterable: login, wallet.created, sends, signatures) + **Live system log** (tail the engine) · **Settings** (admin key shown as "configured ✓", create demo account, seed/reset, faucet + tx-hash lookup). Tabs are keyboard-navigable + hash-routed (`#admin/token`); click **◆ VenCura** to return Home.
10. **Concurrency demo** (Wallets → expand → Concurrency): **Simulate** (dry-run nonce timeline, no funds) always works; on the funded wallet, **Fire 5 concurrent sends** → "5/5 serialized — unique, consecutive nonces ✓" (self-sends; proves the per-wallet nonce lock). — *correctness under concurrency*

## D. Code deliverables
11. **Tests:** `pnpm --filter @vencura/api test` (~91 unit/integration + a DB e2e in CI). **Security writeup:** `docs/SECURITY.md` + `docs/architecture.html`. **SDK / example scripts:** `packages/sdk`.

## Requirement coverage

| Requirement | Step |
|---|---|
| Create account/wallet | A2 |
| `getBalance` · `signMessage` · `sendTransaction` | A3 · A5 · A4 |
| Native **+ ERC-20** | A4 · B6–8 |
| Transaction history (on/off-chain) | A4, C9 |
| Contract read/write | B6–8 |
| Concurrency correctness | C10 |
| Security writeup · tests · example code | D11 |
| *Stretch:* governance | Limits (C9), audit log (C9), approve/transferFrom gate (B) |

## Things to say out loud
1. *"Updates aren't live by design — I click Refresh."* (So PENDING → CONFIRMED doesn't look broken.)
2. The **approve → transferFrom** is the custody story: the admin can only move the user's funds *after* the user grants an on-chain allowance.
