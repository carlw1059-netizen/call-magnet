ALTER TABLE email_copy ADD COLUMN IF NOT EXISTS heading      text NOT NULL DEFAULT '';
ALTER TABLE email_copy ADD COLUMN IF NOT EXISTS subheading   text NOT NULL DEFAULT '';
ALTER TABLE email_copy ADD COLUMN IF NOT EXISTS body_text    text NOT NULL DEFAULT '';
ALTER TABLE email_copy ADD COLUMN IF NOT EXISTS button_label text NOT NULL DEFAULT '';
ALTER TABLE email_copy ADD COLUMN IF NOT EXISTS footnote     text NOT NULL DEFAULT '';
ALTER TABLE email_copy ADD COLUMN IF NOT EXISTS in_use       boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN email_copy.body_text IS 'Plain words only. Leave a blank line between paragraphs. Placeholders like {{BUSINESS_NAME}} are filled in automatically.';
COMMENT ON COLUMN email_copy.body IS 'OLD — not used any more. Edit heading / subheading / body_text / button_label / footnote instead.';

INSERT INTO email_copy (email_key, subject, preheader, heading, subheading, body_text, button_label, footnote, in_use, notes) VALUES
('welcome_new_user', 'Welcome to CallMagnet — your dashboard is ready', 'Your CallMagnet dashboard is ready — log in now',
 'Welcome to CallMagnet, {{BUSINESS_NAME}}.', 'Your missed-call SMS system is set up and ready to go.',
 'Your Middle Man page is live. When a customer calls and you miss it, they automatically receive an SMS with a link to your page.

Log in to your dashboard to see your activity, customise your buttons, and track every missed call.',
 'Go to my dashboard →', '', true, 'Login details box and install steps are added by the code.'),
('welcome_existing_user', 'Welcome to CallMagnet — your dashboard is ready', 'Your CallMagnet dashboard is ready — log in now',
 'Welcome to CallMagnet, {{BUSINESS_NAME}}.', 'Your missed-call SMS system is set up and ready to go.',
 'Your Middle Man page is live. When a customer calls and you miss it, they automatically receive an SMS with a link to your page.

Log in to your dashboard to see your activity, customise your buttons, and track every missed call.

Use your existing email and password to sign in. If you''ve forgotten your password, tap "Forgot password?" on the login page.',
 'Go to my dashboard →', '', true, 'Install steps are added by the code.'),
('login_link', 'Your CallMagnet login link', 'Tap to log in to CallMagnet. Link expires in 1 hour.',
 'Your login link', 'This link expires in 1 hour for security.',
 'Tap the button below to log in to your CallMagnet dashboard.',
 'Log in to CallMagnet →', 'If you didn''t request this link, you can ignore this email.', true, NULL),
('account_live', 'Your CallMagnet account is now live', 'Your CallMagnet account is now live',
 'Your account is live, {{BUSINESS_NAME}}.', 'Your CallMagnet system is active and ready.',
 'Log in to your dashboard to see your activity.',
 'Go to my dashboard →', '', true, NULL),
('payment_received', 'Payment received — we''re setting up your account', 'Payment received — we are setting up your account',
 'Payment confirmed. We''re on it.', '{{BUSINESS_NAME}} — Setup fee',
 'We''re now setting up your Middle Man page and getting everything ready. We''ll be in touch shortly with your login details and next steps.',
 '', '', true, 'Amount paid box is added by the code.'),
('you_are_live', 'You''re live, {{BUSINESS_NAME}}.', 'Your CallMagnet system is live',
 'You''re live, {{BUSINESS_NAME}}.', 'Your CallMagnet system is active.',
 'From this moment, every missed call to your number triggers an automatic SMS to the caller. Your Middle Man page is live and your dashboard is ready.',
 'View your dashboard →', '', true, NULL),
('carl_new_client_alert', 'New client paid — ready to build', '{{BUSINESS_NAME}} paid their setup fee',
 'New client paid.', 'Setup fee received — ready to build.', '', 'Open admin →', '', true, 'To Carl. Business / email / package rows are added by the code.'),
('farewell', 'Your CallMagnet subscription has ended — thanks for being with us', 'Thanks for being a CallMagnet client, {{BUSINESS_NAME}}.',
 'Thanks for trying CallMagnet, {{BUSINESS_NAME}}.', 'Your subscription has ended. Here''s a look back at what CallMagnet did for you.',
 'If there''s anything we could have done better, or if you''d like to come back, we''d love to hear from you.',
 'Send us feedback →', 'Wishing you and {{BUSINESS_NAME}} all the best. 🙏', true, 'Lifetime stats box is added by the code.'),
('expiry_warning', 'Your CallMagnet free period ends in 3 days — {{BUSINESS_NAME}}', 'Your CallMagnet free period ends on {{END_DATE}}',
 'Your free period ends soon, {{BUSINESS_NAME}}', '3 days to go.',
 'Your CallMagnet free period ends on {{END_DATE}}. After this date your subscription will continue automatically.',
 'View your dashboard →', '', true, NULL),
('expiry_admin_alert', '[CallMagnet] Free period ending soon — {{BUSINESS_NAME}}', '{{BUSINESS_NAME}} free period ends in 3 days',
 'Free period ending — {{BUSINESS_NAME}}', '3 days from now.', '', '',
 'Consider reaching out to confirm their subscription continues.', true, 'To Carl.'),
('sms_usage_alert', '[CallMagnet] SMS usage alert — {{BUSINESS_NAME}} ({{SMS_COUNT}}/{{SMS_INCLUDED}} this month)', '{{BUSINESS_NAME}} has used {{SMS_COUNT}}/{{SMS_INCLUDED}} SMS this month',
 'SMS usage alert — {{BUSINESS_NAME}}', 'Approaching or at their monthly limit.', '', '', '', true, 'To Carl.'),
('weekly_summary', 'CallMagnet Weekly Summary', 'Your CallMagnet weekly summary — {{WEEK_LABEL}}',
 '{{MISSED_CALLS}} people tried to reach {{BUSINESS_NAME}} last week', 'Week of {{WEEK_LABEL}}', '',
 'View your dashboard →', '', true, 'Stats, button clicks, social taps and heatmap are added by the code.'),
('weekly_digest', 'CallMagnet Weekly — {{DATE_RANGE}}', 'CallMagnet weekly totals',
 'CallMagnet Weekly', '{{DATE_RANGE}}', '', '', '', true, 'To Carl. Totals are added by the code.'),
('monthly_recap', 'Your {{MONTH}} CallMagnet recap', 'Your {{MONTH}} CallMagnet recap',
 'Hi {{BUSINESS_NAME}},', 'Here''s how {{MONTH}} went.', '',
 'View your dashboard →', '', true, 'Stat tiles, busiest day and area comparison are added by the code.'),
('monthly_report_summary', '[monthly-report] {{PERIOD}}: {{SENT}} sent, {{SKIPPED}} skipped, {{FAILED}} failed', 'Monthly report {{PERIOD}}: {{SENT}} sent / {{SKIPPED}} skipped / {{FAILED}} failed',
 'Monthly report run — {{PERIOD}}', '{{SENT}} sent · {{SKIPPED}} skipped · {{FAILED}} failed', '', '', '', true, 'To Carl.'),
('error_alert', '⚠️ CallMagnet — {{FUNCTION_NAME}} failed', '{{FUNCTION_NAME}} failed',
 '⚠️ {{FUNCTION_NAME}} failed', '', '', '', '', true, 'To Carl. Function / error / time rows are added by the code.')
ON CONFLICT (email_key) DO UPDATE SET
  subject = EXCLUDED.subject, preheader = EXCLUDED.preheader, heading = EXCLUDED.heading,
  subheading = EXCLUDED.subheading, body_text = EXCLUDED.body_text, button_label = EXCLUDED.button_label,
  footnote = EXCLUDED.footnote, in_use = EXCLUDED.in_use, notes = EXCLUDED.notes, updated_at = now();

UPDATE email_copy SET in_use = false, notes = 'NOT USED — this email is switched off'
WHERE email_key IN ('daily_summary_active','daily_summary_quiet','day_14','day_30',
  'button_tap_restaurant','button_tap_barber','button_tap_default',
  'booking_logged_restaurant','booking_logged_barber','booking_logged_default');
