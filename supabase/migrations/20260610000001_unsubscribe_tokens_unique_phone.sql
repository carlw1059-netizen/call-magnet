ALTER TABLE public.unsubscribe_tokens DROP CONSTRAINT IF EXISTS unsubscribe_tokens_client_phone_unique;
ALTER TABLE public.unsubscribe_tokens ADD CONSTRAINT unsubscribe_tokens_client_phone_unique UNIQUE (client_id, phone_number);
