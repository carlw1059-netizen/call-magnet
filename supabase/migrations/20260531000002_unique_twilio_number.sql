-- Prevent multiple clients sharing the same Twilio number.
-- A shared twilio_number causes get_client_vertical() to return an arbitrary
-- client row, routing missed-call SMS to the wrong business.
-- Partial index: NULLs excluded so a client without a Twilio number yet
-- does not collide with other NULL rows.
CREATE UNIQUE INDEX IF NOT EXISTS clients_twilio_number_unique
  ON clients(twilio_number)
  WHERE twilio_number IS NOT NULL;
