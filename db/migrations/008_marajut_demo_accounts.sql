-- Rename the five synthetic accounts in place so existing demo orders and memberships keep their owners.
-- Match the exact previous fixture addresses by their UTF-8 SHA-256 fingerprints.
WITH demo_accounts(local_part, role, previous_email_sha256) AS (
  VALUES
    ('customer', 'customer', '0ffa3f6708c5e84733c70d6c172525b6f34416e0eb6c65032751af8a811cc18c'),
    ('customer2', 'customer', 'd2e35d8366e5c2e5cfb450bf1a9556c511bae57723e5b651acb19b646b6e8310'),
    ('tailor', 'provider', '71c060438f1e7368016b4bd3853693e1c89cb804a4f90f804e30152e8acd4327'),
    ('tailor2', 'provider', 'a0ee50740637a79e0620b153e56a97ddc1edeb57949daa31660401c83a2de99c'),
    ('operator', 'operator', '9d1843a3263d179347b0912d98c41ae791eb94c1cff10868d194fb6119ab8ac2')
)
UPDATE users AS account
SET email = demo_accounts.local_part || '@marajut.test'
FROM demo_accounts
WHERE sha256(convert_to(account.email, 'UTF8')) = decode(demo_accounts.previous_email_sha256, 'hex')
  AND account.role = demo_accounts.role
  AND NOT EXISTS (
    SELECT 1 FROM users AS current_account
    WHERE current_account.email = demo_accounts.local_part || '@marajut.test'
  );
