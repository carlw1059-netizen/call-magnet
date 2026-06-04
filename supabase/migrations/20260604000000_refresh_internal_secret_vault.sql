-- Refresh INTERNAL_SECRET in Vault to match Edge Functions env var.
-- Fixes monthly-report cron silent 401 caused by Vault drift.
UPDATE vault.secrets
SET secret = '10ce2cdb15a12254b809ef34466d99c0970860259b91b1dbe487de66fb903315'
WHERE name = 'INTERNAL_SECRET';
