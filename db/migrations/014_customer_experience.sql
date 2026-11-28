CREATE TABLE business_photos (
  business_id uuid PRIMARY KEY REFERENCES businesses ON DELETE CASCADE,
  content bytea NOT NULL
);

CREATE TABLE customer_notification_reads (
  event_id uuid PRIMARY KEY REFERENCES domain_events ON DELETE CASCADE
);

CREATE TABLE service_reviews (
  order_id uuid PRIMARY KEY REFERENCES orders ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  reply text CHECK (char_length(reply) BETWEEN 1 AND 500),
  replied_at timestamptz,
  CHECK ((reply IS NULL) = (replied_at IS NULL))
);
