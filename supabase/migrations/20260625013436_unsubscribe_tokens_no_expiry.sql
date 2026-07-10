-- Make expires_at nullable in unsubscribe_tokens.
-- Legal requirement: opt-out links must never expire — customers must always
-- be able to unsubscribe. The used_at field still prevents replay (single-use).

ALTER TABLE public.unsubscribe_tokens
  ALTER COLUMN expires_at DROP NOT NULL;

-- Update comment to reflect the new policy
COMMENT ON TABLE public.unsubscribe_tokens IS
  'Short-lived opaque tokens embedded in SMS unsubscribe links. '
  'expires_at is NULL (tokens never expire — legal requirement). '
  'used_at is set to now() when the token is consumed — prevents replay attacks.';
