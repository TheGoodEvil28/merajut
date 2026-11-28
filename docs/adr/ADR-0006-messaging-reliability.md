# ADR-0006 · Messaging inbox, outbox and failure handling

**Status** [PROPOSAL] Pending review · **Date** 18 November 2026 WIB

[Parent RFC](../rfc/RFC-0001-MERAJUT-RECONSTRUCTION.md)

## Decision

Persist verified inbound events before acknowledging, deduplicate at ingestion and at domain write, and process notifications through a transactional PostgreSQL outbox. Claim with leases and fencing, bound retries, and reconcile duplicate/out-of-order receipts. Put uncertain sends into review unless vendor idempotency is demonstrated.

## Alternatives

Synchronous delivery couples customer actions to vendor health. A separate broker adds operations and still needs a DB consistency pattern. Blind retries after ambiguous sends can duplicate messages.

## Consequences and verification

Delivery is asynchronous and observed independently. Run duplicate, timeout, stale-lease, receipt race, unavailable-vendor and manual requeue tests.

## Owners and open decisions

Integration and engineering leads · Verify vendor guarantees, retry horizon, operating alerts and reconciliation workflow.

