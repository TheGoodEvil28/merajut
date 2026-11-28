ALTER TABLE orders
  ADD COLUMN tailor_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN tailor_reply_at timestamptz;
