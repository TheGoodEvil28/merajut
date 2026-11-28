# ADR-0003 · Provider identity and tenancy

**Status** [PROPOSAL] Pending review · **Date** 18 November 2026 WIB

[Parent RFC](../rfc/RFC-0001-MERAJUT-RECONSTRUCTION.md)

## Decision

Model businesses and memberships separately from users. Invite one active operator per business in MVP. Admin publishes the business and catalogue. Enforce business-scoped repositories and composite FKs. Customers see their own records. Platform triage of unassigned WhatsApp threads uses narrowly privileged audited access.

## Alternatives

A tailor user as tenant conflates identity and ownership. A pooled job marketplace exposes data before assignment. Physical databases per tenant add overhead for MVP.

## Consequences and verification

Revoking membership immediately stops access. Future staff can use the same model. Automated cross-business tests are required for each child resource. Consider RLS as defense in depth after core queries are proven.

## Owners and open decisions

Product and engineering leads · Confirm marketplace allocation, moderation owners and unified admin scope.

