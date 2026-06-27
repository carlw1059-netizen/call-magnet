create table if not exists public.test_sms_log (
  id uuid primary key default gen_random_uuid(),
  client_slug text not null,
  to_number text not null,
  message_body text not null,
  twilio_sid text,
  cost numeric(6,4) not null default 0.1000,
  sent_at timestamptz not null default now()
);

alter table public.test_sms_log enable row level security;
