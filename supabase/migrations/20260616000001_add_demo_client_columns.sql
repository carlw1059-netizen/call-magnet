-- Add demo account columns
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_demo_account boolean DEFAULT false;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;

-- Insert demo client rows (idempotent via ON CONFLICT)
INSERT INTO public.clients (
  id, business_name, email, owner_name, owner_phone,
  twilio_number, account_status, middle_man_enabled, middle_man_slug,
  vertical, pricing_package, plan_type, sms_included, avg_job_value,
  is_demo_account, is_locked, customer_sms_template,
  middle_man_buttons
) VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'Demo Restaurant', 'demo@callmagnet.com.au', 'Carl Wittkopp', '+61415961752',
  '+61200000001', 'active', true, 'demo-restaurant',
  'restaurant', 'restaurant', 'restaurant', 75, 120,
  true, false,
  'Hi — we missed your call. Book online: [LINK] Reply STOP to opt out.',
  '[{"intent":"🍽️ Book a table","type":"form","enabled":true,"sort_order":1},{"intent":"📋 View our menu","type":"link","url":"#","enabled":true,"sort_order":2},{"intent":"🎉 Function enquiry","type":"form","enabled":true,"sort_order":3}]'::jsonb
), (
  'a1000000-0000-0000-0000-000000000002',
  'Demo Barber', 'demo@callmagnet.com.au', 'Carl Wittkopp', '+61415961752',
  '+61200000002', 'active', true, 'demo-barber',
  'hairdresser', 'hairdresser', 'hairdresser', 50, 120,
  true, false,
  'Hi — we missed your call. Book online: [LINK] Reply STOP to opt out.',
  '[{"intent":"✂️ Book an appointment","type":"form","enabled":true,"sort_order":1},{"intent":"💈 View our services","type":"link","url":"#","enabled":true,"sort_order":2},{"intent":"🎁 Gift voucher enquiry","type":"form","enabled":true,"sort_order":3}]'::jsonb
), (
  'a1000000-0000-0000-0000-000000000003',
  'Demo Cafe', 'demo@callmagnet.com.au', 'Carl Wittkopp', '+61415961752',
  '+61200000003', 'active', true, 'demo-cafe',
  'restaurant', 'restaurant', 'restaurant', 75, 120,
  true, false,
  'Hi — we missed your call. Book online: [LINK] Reply STOP to opt out.',
  '[{"intent":"☕ Book a table","type":"form","enabled":true,"sort_order":1},{"intent":"🥐 View our menu","type":"link","url":"#","enabled":true,"sort_order":2},{"intent":"🎂 Private event enquiry","type":"form","enabled":true,"sort_order":3}]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
