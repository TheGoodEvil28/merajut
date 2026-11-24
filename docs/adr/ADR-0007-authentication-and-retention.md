# ADR-0007 · Authentication, contact binding and retention

**Status** [PROPOSAL] Pending review · **Date** 18 November 2026 WIB

[Parent RFC](../rfc/RFC-0001-DJAHIT-RECONSTRUCTION.md)

## Decision

Use revocable cookie sessions, invited provider logins and verified customer email. Permit guest intake with scoped upload limits. Bind WhatsApp with channel proof plus authenticated customer confirmation. Store only necessary contact and structured content. Apply draft 7/30/90-day and 12-month retention windows from RFC §8 after privacy review.

## Alternatives

Legacy browser bearer storage and matching a phone to an existing account provide weaker session and ownership boundaries. Mandatory customer registration adds initial friction.

## Consequences and verification

Account recovery, rotate/revoke, CSRF protection, contact unlink and purge are release checks. Private-media and cross-account tests cover link replay and unauthorized ownership. Synthetic data is required for public demo use.

## Owners and open decisions

Engineering and privacy leads · Confirm mail delivery, recovery/support, notices, storage region, retention and deletion.

