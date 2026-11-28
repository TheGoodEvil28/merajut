# ADR-0005 · Quote and order lifecycle

**Status** [PROPOSAL] Pending review · **Date** 18 November 2026 WIB

[Parent RFC](../rfc/RFC-0001-MERAJUT-RECONSTRUCTION.md)

## Decision

Allow a provider to issue immutable quote revisions. Accept one active, unexpired revision from the verified customer. Serialize quote changes on the inquiry row. Create exactly one order plus decision, snapshot, audit event and eligible outbox intent in a single transaction. Manage order progression with scoped named commands.

## Alternatives

Legacy tailor claim skips customer agreement. A generic status update leaves authorization and business states ambiguous. Full event sourcing adds a replay and projection burden.

## Consequences and verification

Structured lifecycle with truthful work status and concurrency guarantees. Tests cover simultaneous accept, supersede, expire, withdraw and status updates. RFC §5 defines transitions.

## Owners and open decisions

Product and engineering leads · Confirm immediate confirmation on acceptance, expiry and cancellation rules.

