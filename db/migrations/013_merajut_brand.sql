-- Move the previous synthetic email domain in place, preserving owners and proof links.
WITH addresses AS (
  SELECT email FROM users WHERE email LIKE '%@marajut.test'
  UNION
  SELECT email FROM account_challenges WHERE email LIKE '%@marajut.test'
), candidates AS (
  SELECT email AS old_email, regexp_replace(email, '@marajut\.test$', '@merajut.test') AS new_email
  FROM addresses
), available AS MATERIALIZED (
  SELECT c.* FROM candidates c
  WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = c.new_email)
    AND NOT EXISTS (
      SELECT 1 FROM account_challenges previous
      JOIN account_challenges current ON current.email = c.new_email AND current.draft_key = previous.draft_key
      WHERE previous.email = c.old_email
    )
), moved_proofs AS (
  UPDATE account_challenges proof SET email = a.new_email FROM available a WHERE proof.email = a.old_email
)
UPDATE users account SET email = a.new_email,
  display_name = replace(account.display_name, 'Marajut', 'Merajut')
FROM available a WHERE account.email = a.old_email;

-- Correct labels on the two synthetic WhatsApp pilot profiles without changing their public URLs.
UPDATE businesses SET name = replace(name, 'Uji Marajut', 'Uji Merajut')
WHERE slug IN ('andika-uji-marajut','uji-dispatch-openwa');

UPDATE services s SET name = replace(s.name, '[UJI MARAJUT]', '[UJI MERAJUT]')
FROM businesses b WHERE s.business_id = b.id AND b.slug IN ('andika-uji-marajut','uji-dispatch-openwa');
