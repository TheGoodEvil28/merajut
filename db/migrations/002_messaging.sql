CREATE TABLE simulation_preferences (
  customer_id uuid PRIMARY KEY REFERENCES users,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES domain_events,
  recipient_id uuid NOT NULL REFERENCES users,
  purpose text NOT NULL CHECK (purpose IN ('QUOTE_READY', 'ORDER_READY')),
  mode text NOT NULL CHECK (mode = 'simulated'),
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN
    ('QUEUED', 'SENDING', 'RETRY_WAIT', 'SIMULATED', 'SUPPRESSED', 'FAILED', 'NEEDS_REVIEW')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipient_id, purpose)
);
CREATE INDEX outbox_ready ON notification_outbox (mode, state, next_attempt_at, lease_until);

CREATE TABLE simulated_messages (
  intent_id uuid PRIMARY KEY REFERENCES notification_outbox,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE worker_heartbeats (
  mode text PRIMARY KEY,
  seen_at timestamptz NOT NULL
);
