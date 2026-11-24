CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_digest text NOT NULL,
  role text NOT NULL CHECK (role IN ('customer', 'provider')),
  verified_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  token_digest text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  area text NOT NULL,
  description text NOT NULL,
  published boolean NOT NULL DEFAULT false
);

CREATE TABLE provider_memberships (
  business_id uuid NOT NULL REFERENCES businesses,
  user_id uuid NOT NULL REFERENCES users,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (business_id, user_id)
);
CREATE UNIQUE INDEX one_operator_per_business ON provider_memberships (business_id) WHERE active;
CREATE UNIQUE INDEX one_business_per_operator ON provider_memberships (user_id) WHERE active;

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses,
  name text NOT NULL,
  description text NOT NULL,
  price_hint integer NOT NULL CHECK (price_hint BETWEEN 0 AND 100000000),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (business_id, id)
);

CREATE TABLE inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses,
  service_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES users,
  description text NOT NULL,
  desired_date date,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN
    ('NEW', 'NEEDS_DETAILS', 'UNDER_REVIEW', 'QUOTED', 'ACCEPTED', 'CANCELLED', 'DECLINED')),
  revision integer NOT NULL DEFAULT 1,
  request_key uuid NOT NULL,
  request_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (customer_id, request_key),
  FOREIGN KEY (business_id, service_id) REFERENCES services (business_id, id)
);
CREATE INDEX inquiry_business_queue ON inquiries (business_id, created_at DESC, id);
CREATE INDEX inquiry_customer_history ON inquiries (customer_id, created_at DESC, id);

CREATE TABLE quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  inquiry_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  eta date NOT NULL,
  terms text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SENT' CHECK (status IN
    ('SENT', 'SUPERSEDED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN')),
  issued_by uuid NOT NULL REFERENCES users,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id, version),
  UNIQUE (inquiry_id, id),
  FOREIGN KEY (business_id, inquiry_id) REFERENCES inquiries (business_id, id)
);
CREATE UNIQUE INDEX one_sent_quote ON quotes (inquiry_id) WHERE status = 'SENT';

CREATE TABLE quote_decisions (
  quote_id uuid PRIMARY KEY REFERENCES quotes,
  customer_id uuid NOT NULL REFERENCES users,
  decision text NOT NULL CHECK (decision IN ('ACCEPTED', 'REJECTED')),
  decided_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL UNIQUE,
  business_id uuid NOT NULL,
  quote_id uuid NOT NULL UNIQUE,
  amount integer NOT NULL CHECK (amount BETWEEN 1 AND 100000000),
  currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  eta date NOT NULL,
  terms text NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN
    ('CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED')),
  revision integer NOT NULL DEFAULT 1,
  UNIQUE (inquiry_id, id),
  FOREIGN KEY (business_id, inquiry_id) REFERENCES inquiries (business_id, id),
  FOREIGN KEY (inquiry_id, quote_id) REFERENCES quotes (inquiry_id, id)
);

CREATE TABLE domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  inquiry_id uuid NOT NULL REFERENCES inquiries,
  order_id uuid,
  actor_id uuid NOT NULL REFERENCES users,
  kind text NOT NULL,
  old_status text,
  new_status text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (inquiry_id, order_id) REFERENCES orders (inquiry_id, id)
);
CREATE INDEX domain_event_stream ON domain_events (inquiry_id, sequence);
