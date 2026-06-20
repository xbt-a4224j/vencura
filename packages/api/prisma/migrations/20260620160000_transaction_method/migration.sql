-- Record which contract function a write called (asset='CALL'), so the activity log can read
-- "approve → token" / "transferFrom → token" instead of a meaningless "sent 0 tokens".
ALTER TABLE "transactions" ADD COLUMN "method" TEXT;
