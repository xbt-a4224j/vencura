// CLI runner for the demo seed: `pnpm --filter @vencura/api db:seed`.
// The actual routine lives in src/admin/seed.ts so the dev-gated POST /admin/seed reuses it.
import { PrismaClient } from '@prisma/client';
import { seedDemo } from '../src/admin/seed';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await seedDemo(prisma);
    console.log('seeded demo user:', result.email, `(password: ${result.password})`);
    for (const w of result.wallets) {
      console.log(`  wallet ${w.address} — fund via Sepolia faucet`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
