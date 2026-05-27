SELECT cron.schedule(
  'warmup-send-twilio-sms',
  '*/5 * * * *',
  $$SELECT net.http_get(
    url := 'https://iskvvnhacqdxybpmwuni.supabase.co/functions/v1/send-twilio-sms?warmup=1',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlza3Z2bmhhY3FkeHlicG13dW5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MTAyOTYsImV4cCI6MjA5MDA4NjI5Nn0.c3uR-CSQXsgfYMnzK8KOxZjoqRPwaMsUuGpMPwvCsk8"}'::jsonb
  ) AS request_id$$
);
