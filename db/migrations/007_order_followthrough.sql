ALTER TABLE inquiries
  ADD COLUMN requested_handover text CHECK (requested_handover IN ('pickup', 'delivery')),
  ADD COLUMN fitting_requested boolean;

ALTER TABLE orders
  ADD COLUMN fitting_at timestamptz,
  ADD COLUMN fitting_place text,
  ADD COLUMN fitting_state text CHECK (fitting_state IN ('SCHEDULED','REQUESTED','PROPOSED','DONE')),
  ADD CONSTRAINT order_fitting_fields CHECK (
    (fitting_at IS NULL AND fitting_place IS NULL AND fitting_state IS NULL)
    OR (fitting_at IS NOT NULL AND fitting_place IS NOT NULL AND fitting_state IS NOT NULL)
  ),
  ADD COLUMN shipped_at timestamptz,
  ADD COLUMN shipping_note text,
  ADD CHECK ((shipped_at IS NULL) = (shipping_note IS NULL));

UPDATE orders o
SET fitting_at = q.fitting_at, fitting_place = q.fitting_place,
    fitting_state = CASE WHEN o.status IN ('READY','COMPLETED') THEN 'DONE' ELSE 'SCHEDULED' END
FROM quotes q
WHERE o.quote_id = q.id AND o.fee_bps IS NOT NULL AND q.fitting_at IS NOT NULL;
