ALTER TABLE services
  ADD COLUMN category text NOT NULL DEFAULT 'other' CHECK (category IN ('alteration', 'repair', 'custom', 'other')),
  ADD COLUMN lead_days integer CHECK (lead_days BETWEEN 1 AND 365),
  ADD COLUMN intake_hint text CHECK (char_length(intake_hint) BETWEEN 1 AND 300);

UPDATE services s SET category = demo.category, intake_hint = demo.hint
FROM businesses b, (VALUES
  ('jahit-rina', 'Hem adjustment', 'alteration', 'Sebutkan bagian yang ingin dipendekkan dan panjang yang diinginkan.'),
  ('jahit-rina', 'Zipper replacement', 'repair', 'Sebutkan jenis pakaian, letak, dan kondisi ritsleting.'),
  ('ruang-jahit-dewi', 'Seam repair', 'repair', 'Sebutkan letak jahitan yang terbuka dan panjang bagian yang perlu diperbaiki.')
) AS demo(slug, name, category, hint)
WHERE b.id = s.business_id AND b.slug = demo.slug AND s.name = demo.name;

ALTER TABLE inquiries
  ADD COLUMN quantity integer CHECK (quantity BETWEEN 1 AND 50),
  ADD COLUMN fit_notes text CHECK (char_length(fit_notes) BETWEEN 1 AND 500);

ALTER TABLE quotes
  ADD COLUMN line_items jsonb CHECK (
    CASE WHEN jsonb_typeof(line_items) = 'array' THEN jsonb_array_length(line_items) BETWEEN 1 AND 8
      ELSE line_items IS NULL END
  );

CREATE TABLE inquiry_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES inquiries,
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 3145728),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiry_photos_owner ON inquiry_photos(inquiry_id, created_at);
