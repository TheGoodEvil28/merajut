ALTER TABLE users ADD COLUMN phone text, ADD COLUMN address text;
ALTER TABLE businesses ADD COLUMN whatsapp text, ADD COLUMN specialty text;
ALTER TABLE inquiries
  ADD COLUMN dispatch_state text CHECK (dispatch_state IN ('OPEN','CONTACTED','AVAILABLE','UNAVAILABLE')),
  ADD COLUMN estimate bigint,
  ADD COLUMN previous_inquiry_id uuid UNIQUE REFERENCES inquiries(id);
-- Rows already in flight retain their quote and cash workflow.
ALTER TABLE inquiries ALTER COLUMN dispatch_state SET DEFAULT 'OPEN';
ALTER TABLE quotes ADD COLUMN handover text CHECK (handover IN ('pickup','delivery')),
  ADD COLUMN fitting_at timestamptz, ADD COLUMN fitting_place text,
  ADD CHECK ((fitting_at IS NULL) = (fitting_place IS NULL));
ALTER TABLE orders ADD COLUMN fee_bps integer CHECK (fee_bps BETWEEN 0 AND 10000),
  ADD COLUMN complaint text, ADD COLUMN resolution text;
CREATE TABLE order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders,
  mode text NOT NULL CHECK (mode IN ('demo','sandbox','live')),
  amount integer NOT NULL CHECK (amount > 0),
  fee integer NOT NULL CHECK (fee BETWEEN 0 AND amount),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PAID','FAILED')),
  va_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz
);
CREATE UNIQUE INDEX order_payment_active ON order_payments(order_id) WHERE state <> 'FAILED';
CREATE INDEX order_payment_history ON order_payments(order_id,created_at DESC);
