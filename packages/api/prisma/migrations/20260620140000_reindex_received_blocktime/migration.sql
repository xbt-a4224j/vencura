-- The first pass of IncomingWatcher stamped received transfers with their indexing time (now())
-- instead of the on-chain block time, so a deposit from yesterday showed as "today, 9am". The fix
-- stores block time at insert; clear the mislabeled backfill and rewind the scan cursor so the
-- watcher re-indexes the same range with correct timestamps. (Derived cache — safe to rebuild.)
DELETE FROM "received_transfers";
DELETE FROM "chain_cursor" WHERE "name" = 'incoming';
