-- Fix: allow target_cpl_cents >= 10 for instagram_traffic objective (was >= 50)
ALTER TABLE account_directions
  DROP CONSTRAINT IF EXISTS account_directions_target_cpl_cents_check;

ALTER TABLE account_directions
  ADD CONSTRAINT account_directions_target_cpl_cents_check
  CHECK (target_cpl_cents >= 1);
