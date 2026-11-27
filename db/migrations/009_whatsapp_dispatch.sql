CREATE TABLE whatsapp_dispatch_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('mock','openwa')),
  session_id text NOT NULL,
  scope_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('group','partner')),
  business_id uuid REFERENCES businesses,
  chat_id text NOT NULL,
  sender_alias text,
  verified_group text,
  verified_group_version integer,
  purpose text NOT NULL DEFAULT 'tailor_dispatch',
  evidence text NOT NULL CHECK (char_length(evidence) BETWEEN 5 AND 500),
  version integer NOT NULL DEFAULT 1,
  verified_by uuid NOT NULL REFERENCES users,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (mode,session_id,scope_key),
  CHECK ((channel='partner') = (business_id IS NOT NULL)),
  CHECK ((verified_group IS NULL) = (verified_group_version IS NULL))
);
CREATE UNIQUE INDEX whatsapp_permission_chat ON whatsapp_dispatch_permissions(mode,session_id,chat_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX whatsapp_permission_alias ON whatsapp_dispatch_permissions(mode,session_id,sender_alias) WHERE revoked_at IS NULL AND sender_alias IS NOT NULL;

CREATE TABLE whatsapp_dispatch_control (
  mode text NOT NULL,
  session_id text NOT NULL,
  paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mode,session_id)
);

CREATE TABLE whatsapp_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES inquiries,
  business_id uuid NOT NULL REFERENCES businesses,
  actor_id uuid NOT NULL REFERENCES users,
  channel text NOT NULL CHECK (channel IN ('group','partner')),
  approved_revision integer NOT NULL,
  request_key uuid NOT NULL,
  preview_digest text NOT NULL,
  snapshot_digest text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('mock','openwa')),
  session_id text NOT NULL,
  recipient text NOT NULL,
  permission_id uuid NOT NULL REFERENCES whatsapp_dispatch_permissions,
  permission_version integer NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  rendered_text text CHECK (char_length(rendered_text)<=4096),
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','SENDING','RETRY_WAIT','SENT','NEEDS_REVIEW','FAILED','CANCELLED','CONFIRMED_MANUALLY')),
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempt_started_at timestamptz,
  provider_message_id text,
  delivery_level integer NOT NULL DEFAULT 0 CHECK (delivery_level BETWEEN 0 AND 3),
  delivery_at timestamptz,
  late_evidence boolean NOT NULL DEFAULT false,
  last_error text,
  reviewed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id,request_key),
  UNIQUE (mode,session_id,provider_message_id)
);
CREATE INDEX whatsapp_dispatch_due ON whatsapp_dispatches(mode,next_attempt_at) WHERE state IN ('QUEUED','RETRY_WAIT','SENDING');
CREATE INDEX whatsapp_dispatch_history ON whatsapp_dispatches(inquiry_id,created_at);

CREATE TABLE whatsapp_dispatch_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('mock','openwa')),
  session_id text NOT NULL,
  delivery_key text NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('message.ack','message.failed','message.received')),
  provider_message_id text,
  chat_id text NOT NULL,
  sender_chat text,
  business_id uuid REFERENCES businesses,
  body text CHECK (char_length(body)<=4096),
  receipt_level integer NOT NULL DEFAULT 0,
  event_at timestamptz NOT NULL,
  message_at timestamptz,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','LINKED','REVIEW','RESOLVED')),
  dispatch_id uuid REFERENCES whatsapp_dispatches,
  inquiry_id uuid REFERENCES inquiries,
  correlation text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (mode,session_id,delivery_key),
  UNIQUE (mode,session_id,event_kind,chat_id,provider_message_id,receipt_level)
);
CREATE INDEX whatsapp_inbox_pending ON whatsapp_dispatch_inbox(state,received_at);
CREATE INDEX whatsapp_inbox_request ON whatsapp_dispatch_inbox(inquiry_id,received_at);

CREATE TABLE whatsapp_dispatch_heartbeats (
  mode text NOT NULL,
  session_id text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  gateway_state text NOT NULL,
  PRIMARY KEY (mode,session_id)
);
