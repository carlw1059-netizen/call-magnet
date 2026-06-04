-- Refresh INTERNAL_SECRET in Vault to match Edge Functions env var.
-- Fixes monthly-report cron silent 401 caused by Vault drift.
-- Uses vault.update_secret() — direct UPDATE on vault.secrets is permission-denied
-- for the migration role; the SECURITY DEFINER function is the correct path.
SELECT vault.update_secret(
  id,
  '10ce2cdb15a12254b809ef34466d99c0970860259b91b1dbe487de66fb903315'
)
FROM vault.secrets
WHERE name = 'INTERNAL_SECRET';
