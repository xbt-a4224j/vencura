#!/usr/bin/env node
/**
 * `vencura` — a thin CLI over @vencura/sdk. Proof the SDK is a real, usable client.
 *
 *   vencura login <email> <password>
 *   vencura balance [--wallet <id>]
 *   vencura sign <message...>
 *   vencura send --to <addr|ens> --amount <eth> [--asset ETH] [--wait]
 *   vencura activity [--wallet <id>]
 *
 * API base: $VENCURA_API_URL (default http://localhost:3000). The JWT persists across invocations
 * in ~/.vencura/token, so `login` once, then run the rest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEther } from 'viem';
import { BasePath, type TokenStore, Vencura, VencuraError } from './index';

const TOKEN_FILE = path.join(os.homedir(), '.vencura', 'token');
const fileTokenStore: TokenStore = {
  get: () => {
    try {
      return fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null;
    } catch {
      return null;
    }
  },
  set: (t) => {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, t, { mode: 0o600 });
  },
  clear: () => {
    try {
      fs.unlinkSync(TOKEN_FILE);
    } catch {
      /* already gone */
    }
  },
};

const v = new Vencura({ basePath: process.env.VENCURA_API_URL ?? BasePath.Local, tokenStore: fileTokenStore });

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const has = (name: string): boolean => rest.includes(`--${name}`);

/** The wallet to act on: --wallet, else the first one (provisioning one if the account has none). */
async function targetWallet(): Promise<{ id: string; address: string }> {
  const id = flag('wallet');
  const wallets = await v.wallets.list();
  if (id) {
    const w = wallets.find((x) => x.id === id);
    if (!w) throw new Error(`no wallet ${id}`);
    return w;
  }
  return wallets[0] ?? (await v.wallets.provision());
}

async function main(): Promise<void> {
  switch (cmd) {
    case 'login': {
      const [email, password] = rest;
      if (!email || !password) throw new Error('usage: vencura login <email> <password>');
      const { user } = await v.auth.login({ email, password });
      console.log(`✓ logged in as ${user.email} (token saved to ${TOKEN_FILE})`);
      break;
    }
    case 'balance': {
      const w = await targetWallet();
      const { balances } = await v.wallets.getBalance({ walletId: w.id });
      console.log(`wallet ${w.address}`);
      for (const b of balances) console.log(`  ${b.symbol}: available=${b.available} confirmed=${b.confirmed}`);
      break;
    }
    case 'sign': {
      const message = rest.filter((a) => !a.startsWith('--')).join(' ');
      if (!message) throw new Error('usage: vencura sign <message...>');
      const w = await targetWallet();
      const { signature } = await v.wallets.signMessage({ walletId: w.id, message });
      console.log(signature);
      break;
    }
    case 'send': {
      const to = flag('to');
      const amount = flag('amount');
      const asset = flag('asset') ?? 'ETH';
      if (!to || !amount) throw new Error('usage: vencura send --to <addr|ens> --amount <eth> [--asset ETH] [--wait]');
      const w = await targetWallet();
      // ETH amounts are given in ether and converted to wei; token amounts are passed as base units.
      const amt = asset === 'ETH' ? parseEther(amount).toString() : amount;
      const tx = has('wait')
        ? await v.transactions.sendAndConfirm({ walletId: w.id, to, asset, amount: amt })
        : await v.transactions.send({ walletId: w.id, to, asset, amount: amt });
      console.log(`${tx.status} · nonce=${tx.nonce} · ${tx.txHash ?? '(no hash)'}`);
      break;
    }
    case 'activity': {
      const w = await targetWallet();
      const items = await v.activity.forWallet({ walletId: w.id });
      for (const it of items.slice(0, 20)) {
        const when = new Date(it.createdAt).toLocaleString();
        if (it.kind === 'transaction') console.log(`${when}  ${it.status}  ${it.method ?? 'sent'} ${it.amount} ${it.asset} → ${it.to}`);
        else if (it.kind === 'received') console.log(`${when}  received  ${it.amount} ${it.asset} ← ${it.from}`);
        else if (it.kind === 'signature') console.log(`${when}  signed  "${it.message}"`);
        else console.log(`${when}  ${it.type}`);
      }
      break;
    }
    default:
      console.log('vencura — commands: login · balance · sign · send · activity');
      console.log('  vencura login <email> <password>');
      console.log('  vencura balance [--wallet <id>]');
      console.log('  vencura sign <message...>');
      console.log('  vencura send --to <addr|ens> --amount <eth> [--asset ETH] [--wait]');
      console.log('  vencura activity [--wallet <id>]');
      if (cmd) process.exitCode = 1;
  }
}

main().catch((e) => {
  const msg = e instanceof VencuraError ? `${e.message}${e.code ? ` [${e.code}]` : ''}` : (e as Error).message;
  console.error(`error: ${msg}`);
  process.exit(1);
});
