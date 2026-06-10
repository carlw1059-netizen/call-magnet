-- Add JOTFORM_WEBHOOK_SECRET to Vault.
-- Replace REPLACE_ME with the real value in the Supabase dashboard after deployment.
SELECT vault.create_secret('REPLACE_ME', 'JOTFORM_WEBHOOK_SECRET');
