#!/usr/bin/env node
// End-to-end smoke test against a RUNNING VenCura stack (API + anvil + seeded demo data).
// Exercises the real flow over HTTP — no mocks. Exits non-zero if any check fails.
// Assumes `scripts/standup.sh` has stood the app up (API on :3000, demo data seeded).
//
//   node scripts/e2e.mjs            # against http://localhost:3000
//   API=http://host:port node scripts/e2e.mjs

const API = process.env.API ?? 'http://localhost:3000';
const DEAD = '0x000000000000000000000000000000000000dEaD';
const ETH = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString(); // n ETH → wei string

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '\x1b[32m✓' : '\x1b[31m✗'} ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function req(path, { method = 'GET', body, token, idem } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['Idempotency-Key'] = idem;
  const res = await fetch(`${API}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`\nE2E against ${API}\n`);

  // 1. health
  check('health is ok', (await req('/health')).json.status === 'ok');

  // 2. fresh user can register + create a wallet (auth path for new users)
  const email = `e2e+${Date.now()}@vencura.test`;
  const reg = await req('/auth/register', {
    method: 'POST',
    body: { email, password: 'password123' },
  });
  check('register returns a token', reg.status === 201 && typeof reg.json.accessToken === 'string');
  const newWallet = await req('/wallets', { method: 'POST', token: reg.json.accessToken });
  check(
    'new user creates a wallet (address only)',
    newWallet.status === 201 && /^0x[0-9a-fA-F]{40}$/.test(newWallet.json.address ?? ''),
  );
  check(
    'wallet response leaks no key material',
    !JSON.stringify(newWallet.json).toLowerCase().includes('encrypt'),
  );

  // 3. log in as the seeded demo user (funded wallets)
  const login = await req('/auth/login', {
    method: 'POST',
    body: { email: 'demo@vencura.local', password: 'demo-password' },
  });
  check('demo login succeeds', login.status === 200 && !!login.json.accessToken);
  const token = login.json.accessToken;
  if (!token) return; // nothing else works without it

  // 4. pick the seeded funded wallet
  const wallets = (await req('/wallets', { token })).json;
  const fundedWallet = wallets?.[0];
  check('demo user has a seeded wallet', !!fundedWallet, fundedWallet ? `wallet ${fundedWallet.address}` : 'none found');
  if (!fundedWallet) return;
  const recipient = DEAD;

  // 5. balance reads (confirmed + available)
  const bal = (await req(`/wallets/${fundedWallet.id}/balance`, { token })).json;
  check(
    'balance returns confirmed + available',
    !!bal.balances?.[0] && 'available' in bal.balances[0],
    bal.balances?.[0] && `${bal.balances[0].confirmed} confirmed`,
  );

  // 6. sign a message
  const sig = await req(`/wallets/${fundedWallet.id}/messages`, {
    method: 'POST',
    token,
    body: { message: 'e2e gm' },
  });
  check(
    'signMessage returns a 0x signature',
    sig.status === 201 && /^0x[0-9a-fA-F]+$/.test(sig.json.signature ?? ''),
  );

  // 7. send → pending, then watcher confirms it
  const send = await req(`/wallets/${fundedWallet.id}/transactions`, {
    method: 'POST',
    token,
    body: { to: recipient, asset: 'ETH', amount: ETH(0.1) },
  });
  check(
    'send → pending',
    send.status === 201 && send.json.status === 'pending',
    `nonce ${send.json.nonce}`,
  );
  let confirmed = false;
  for (let i = 0; i < 12 && !confirmed; i++) {
    await sleep(2000);
    const txs = (await req(`/wallets/${fundedWallet.id}/transactions`, { token })).json;
    confirmed = txs?.[0]?.status === 'confirmed';
  }
  check('confirmation watcher flips it to confirmed', confirmed);

  // 8. idempotency: same key twice → one transaction
  const idem = `e2e-${Date.now()}`;
  const a = await req(`/wallets/${fundedWallet.id}/transactions`, {
    method: 'POST',
    token,
    idem,
    body: { to: recipient, asset: 'ETH', amount: ETH(0.05) },
  });
  const b = await req(`/wallets/${fundedWallet.id}/transactions`, {
    method: 'POST',
    token,
    idem,
    body: { to: recipient, asset: 'ETH', amount: ETH(0.05) },
  });
  check('same idempotency key → same tx id', !!a.json.id && a.json.id === b.json.id);

  // 10. unauthenticated request → 401
  check(
    'unauthenticated send → 401',
    (
      await req(`/wallets/${fundedWallet.id}/transactions`, {
        method: 'POST',
        body: { to: recipient, asset: 'ETH', amount: ETH(0.1) },
      })
    ).status === 401,
  );
}

main()
  .catch((e) => {
    console.error('\x1b[31mE2E crashed:\x1b[0m', e.message);
    failures++;
  })
  .finally(() => {
    console.log(
      `\n${failures === 0 ? '\x1b[32m✓ E2E passed\x1b[0m' : `\x1b[31m✗ E2E failed (${failures})\x1b[0m`}\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
