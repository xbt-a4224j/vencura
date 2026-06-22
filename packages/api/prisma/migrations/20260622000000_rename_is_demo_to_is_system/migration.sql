-- The flag marks the system admin/operator account (not a "demo" account). Rename for clarity.
ALTER TABLE "users" RENAME COLUMN "isDemo" TO "isSystem";
