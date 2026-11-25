# ADR-0002 · Application architecture and monorepo

**Status** [PROPOSAL] Pending review · **Date** 18 November 2026 WIB

[Parent RFC](../rfc/RFC-0001-MARAJUT-RECONSTRUCTION.md)

## Decision

Adopt same-origin Express/server-rendered pages with progressive enhancement and PostgreSQL. Ship one locked application image for web and worker processes. Use one root Compose, versioned DB migrations, private media and managed PostgreSQL for hosting if restore and cost checks pass.

## Alternatives

A separate SPA increases coordination and testing. A queue service or microservices add operations at MVP volume. Hosting on a single VM may be a viable fallback if the team proves backup, TLS and restart behavior.

## Consequences and verification

Simpler session and deploy model. Enforce explicit module boundaries, scoped repositories and integration tests. Builder-free original UI and a single explainable source tree.

## Owners and open decisions

Engineering lead · Validate stack familiarity, hosting budget and the fresh deploy before expanding scope.

