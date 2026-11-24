CREATE TABLE account_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('signup','guest','recovery','invite')),
  email text NOT NULL,
  user_id uuid REFERENCES users,
  business_id uuid REFERENCES businesses,
  draft jsonb,
  draft_key uuid,
  browser_digest text,
  code_digest text UNIQUE,
  mail_attempts integer NOT NULL DEFAULT 0,
  mail_state text NOT NULL DEFAULT 'QUEUED' CHECK (mail_state IN ('QUEUED','SENDING','SENT','FAILED')),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK ((purpose = 'invite') = (business_id IS NOT NULL)),
  CHECK ((purpose = 'guest') = (draft_key IS NOT NULL)),
  UNIQUE (email, draft_key)
);
CREATE INDEX account_challenges_delivery ON account_challenges(next_attempt_at)
  WHERE consumed_at IS NULL AND mail_state IN ('QUEUED','SENDING');
CREATE INDEX account_challenges_address ON account_challenges(email, created_at);
CREATE TABLE guest_photos (
  challenge_id uuid PRIMARY KEY REFERENCES account_challenges ON DELETE CASCADE,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 3145728)
);

CREATE TABLE platform_managers (
  user_id uuid PRIMARY KEY REFERENCES users
);
CREATE TABLE operator_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users,
  action text NOT NULL,
  target_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_events_target ON operator_events(target_id, id);
ALTER TABLE businesses ADD COLUMN moderation_revision integer NOT NULL DEFAULT 1;
ALTER TABLE inquiries DROP CONSTRAINT inquiries_status_check;
ALTER TABLE inquiries ADD CHECK (status IN ('NEW','NEEDS_DETAILS','UNDER_REVIEW','QUOTED','EXPIRED','ACCEPTED','CANCELLED','DECLINED'));
ALTER TABLE domain_events ALTER COLUMN actor_id DROP NOT NULL;
CREATE INDEX quotes_expirable ON quotes(expires_at) WHERE status = 'SENT';
CREATE TABLE order_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders,
  order_revision integer NOT NULL,
  requested_by uuid NOT NULL REFERENCES users,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','APPROVED','DECLINED','SUPERSEDED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users,
  decision_reason text
);
CREATE UNIQUE INDEX order_review_open ON order_reviews(order_id) WHERE state = 'OPEN';
CREATE TABLE cash_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders,
  amount integer NOT NULL CHECK (amount > 0),
  recorded_by uuid NOT NULL REFERENCES users,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_by uuid REFERENCES users,
  voided_at timestamptz,
  void_reason text,
  CHECK ((voided_at IS NULL) = (voided_by IS NULL) AND (voided_by IS NULL) = (void_reason IS NULL))
);
CREATE UNIQUE INDEX cash_current ON cash_receipts(order_id) WHERE voided_at IS NULL;
ALTER TABLE orders ADD COLUMN cash_revision integer NOT NULL DEFAULT 0;

ALTER TABLE inbound_threads ADD COLUMN customer_id uuid REFERENCES users;
UPDATE inbound_threads t SET customer_id = s.customer_id FROM inbound_senders s
  WHERE t.sender_id = s.id AND s.customer_id IS NOT NULL;
ALTER TABLE inbound_threads ADD COLUMN quantity integer CHECK (quantity BETWEEN 1 AND 50),
  ADD COLUMN desired_date date, ADD COLUMN fit_notes text CHECK (char_length(fit_notes) <= 500);
