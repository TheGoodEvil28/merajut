ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'provider', 'operator'));

CREATE TABLE inbound_senders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter text NOT NULL CHECK (adapter = 'simulated'),
  external_id text NOT NULL,
  simulator_owner_id uuid UNIQUE REFERENCES users,
  customer_id uuid REFERENCES users,
  bound_at timestamptz,
  UNIQUE (adapter, external_id),
  CHECK ((customer_id IS NULL) = (bound_at IS NULL))
);

CREATE TABLE inbound_binding_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES inbound_senders,
  customer_id uuid NOT NULL REFERENCES users,
  session_digest text NOT NULL REFERENCES sessions ON DELETE CASCADE,
  code_digest text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  proved_at timestamptz,
  consumed_at timestamptz
);
CREATE INDEX inbound_binding_scope ON inbound_binding_challenges (sender_id, customer_id, expires_at);

CREATE TABLE inbound_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES inbound_senders,
  state text NOT NULL DEFAULT 'AUTOMATED' CHECK (state IN
    ('AUTOMATED', 'AWAITING_CUSTOMER', 'AWAITING_HUMAN', 'HUMAN', 'RESOLVED')),
  business_id uuid,
  service_id uuid,
  details text,
  draft_at timestamptz,
  inquiry_id uuid UNIQUE,
  handled_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id),
  FOREIGN KEY (business_id, inquiry_id) REFERENCES inquiries (business_id, id),
  CHECK ((business_id IS NULL) = (service_id IS NULL)),
  CHECK (draft_at IS NULL OR (service_id IS NOT NULL AND details IS NOT NULL)),
  CHECK (state <> 'HUMAN' OR handled_by IS NOT NULL)
);
CREATE UNIQUE INDEX inbound_active_thread ON inbound_threads (sender_id) WHERE state <> 'RESOLVED';
CREATE INDEX inbound_handoff_queue ON inbound_threads (business_id, state, updated_at DESC);

CREATE TABLE inbound_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  sender_id uuid NOT NULL REFERENCES inbound_senders,
  adapter text NOT NULL CHECK (adapter = 'simulated'),
  external_event_id text NOT NULL,
  fingerprint text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'select_service', 'details', 'handoff', 'binding_proof')),
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED', 'RETRY_WAIT', 'PROCESSED', 'REJECTED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (adapter, external_event_id)
);
CREATE INDEX inbound_pending_sender ON inbound_inbox (sender_id, sequence) WHERE state IN ('QUEUED', 'RETRY_WAIT');

CREATE TABLE inbound_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES inbound_threads,
  inbox_id uuid UNIQUE REFERENCES inbound_inbox,
  direction text NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND', 'SYSTEM')),
  actor_id uuid REFERENCES users,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbound_thread_messages ON inbound_messages (thread_id, id);
