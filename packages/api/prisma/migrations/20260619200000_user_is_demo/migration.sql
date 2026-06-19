-- AlterTable: mark which accounts the one-click demo picker may list.
ALTER TABLE "users" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: the existing seeded demo account uses the shared demo password, so keep it visible.
-- Other historical rows (smoke tests / audit registrations) have their own passwords and are
-- intentionally left isDemo=false so they drop out of the picker.
UPDATE "users" SET "isDemo" = true WHERE "email" = 'demo@vencura.local';
