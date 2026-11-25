# Marajut product experience audit

**Baseline** · Milestone 2 local build, 18 November 2026 WIB. The user requested a Chrome audit and a first provider improvement. The reset brief specifies the product target. The RFC and ADRs supply architecture and privacy boundaries. Product requirements below are targets until verified.

## Verified baseline

Chromium automation used installed Chrome against a separately seeded Compose database on port 3112. The interactive Chrome extension was unavailable. The run visited 18 pages/states with guest, seeded customer and tailor sessions at 360 and 1440 px. Each rendered page fit both widths. Source inspection explained route scopes and absent screens. The sample is an engineering walkthrough with synthetic data.

| Screen and role | Observed current experience | Target and dependency | Priority and verification |
| --- | --- | --- | --- |
| `/` · public landing/discovery | Functional but bare. Published services, provider name/area and price hint were present. The provider name had no profile destination. Mobile layout fit. No category filter or service detail. | Link to a real business profile, retain nonbinding prices and clear request entry. Dedicated category discovery comes later. | First slice. Follow service → profile → preselected request. |
| `/login` and unavailable page · all | Functional. Role sessions work. An unsigned customer who clicked a service was sent to generic login and lost the selected service. Errors and navigation were English. | Preserve safe service context across login, use role-aware navigation and useful recovery copy. | First slice. Browser signs in from a specific listing and lands on its request. |
| Public profile and provider profile editor · missing | No route or screen existed. Business name, area and description were already persisted. | Expose only intended public fields, let the active operator review/edit them, and reflect updates in discovery. Keep business publication policy with platform moderation per ADR-0003. | First slice. Verify persistence, public reflection and tenant/role boundaries. |
| `/requests/new` · customer | Functional but generic. Provider/service select, free text and optional date. No guidance about price agreement or next step. | Show the intended service and explain the quote workflow. Structured measurements, quantity and protected images need a separate iteration. | First slice for orientation, later for optional/private fields. |
| `/workspace` · customer | Functional but bare. Chronological list and badges did not tell the customer when to act or what to expect. | Explain next action and keep customer-only navigation. | First slice for status and copy. |
| `/workspace` · tailor | Functional but bare. The same chronological template served both roles. No count, sorting by due date, work lane or distinction between customer action and tailor action. | A provider home with real state counts, prioritized list, action labels and filtered order history. | Highest priority. Verify transitions move work between the correct queues and do not count another business. |
| `/workspace/services` · tailor | Working create/edit/hide with collapsed forms. Public effects were real, but visibility and starting-price cues were insufficient. | Separate currently visible and hidden counts, useful field help and a public preview. Service categories and duration need a domain change. | First slice for visibility and copy. |
| `/requests/:id` · tailor/customer | Functional but bare. Quote revision and order state were real. Clarification was collapsed below the quote form. Linked WhatsApp context was separate. | Make next action explicit, surface clarification and linked context, retain exact quote acceptance and audited transitions. Itemized amounts and authorized media are later work. | First slice for triage/context. Verify existing conflict and authorization tests. |
| `/workspace/intake`, binding screen and conversation · customer | Functional simulation. Intro, send, select, proof and history were split across technical screens. Simulator link competed with regular order navigation. | Keep a labeled demo entry while normal booking and tracking stand on their own. A unified web/WhatsApp origination contract is later work. | First slice for navigation and copy. |
| `/workspace/intake`, conversation · tailor | Functional tenant-scoped handoff. Queue was separate from the new-request list and the workspace offered no indication of waiting conversations. | Put entitled conversations next to the relevant work queue and provide a clear action to claim/resume. Preserve triage rules and proof gating. | First slice. Chrome exercise pending, claim, simulated reply and conversion. |
| `/workspace/messages` · customer | Good enough as a simulation log. Status was genuine simulator state, separate from the order lifecycle. Refresh was manual. | Keep consent and clearly labeled results alongside an understandable order journey. Live delivery requires separate approvals. | Keep simulation. Verify quote and collection notices and absence of live-delivery claims. |
| Platform triage/admin | Unassigned operator handoff exists in source. Moderation and operational-health UI were outside this audit and absent from the first provider slice. | Lean audited administration after provider workflow. | Later. |

## Experience map for the first slice

- Guest → discovery → public provider profile → service → sign in and return to selected request → customer request → current quote → explicit acceptance → order progress.
- Provider → **Ringkasan** → new inquiry or WhatsApp handoff → clarification or quote → waiting for acceptance → active/ready/history, ordered by promised date where available. **Profil Usaha** and **Layanan Saya** are reachable from role navigation.
- Customer demo → sender proof → assigned handoff → one linked inquiry → regular quote and order. Simulation remains labeled.

This slice uses current business and service fields. It does not elevate provider profile edits to business publication, permit unassigned queue access, change the state machine, or infer payment from completion. Session scope, revision locking and inbox/outbox are retained. Forward commitments for media, itemized quotations, production messaging and real-world validation remain in the roadmap.

## Hosted visual reference

The earlier hosted tailoring site supplied a visual reference. Its clothing-repair campaign used a warm cream background with olive and terracotta accents. The Marajut workspace and marketplace use those palette cues with their own layout and Indonesian copy.

## First slice verified · 19 November 2026 WIB

The local Docker build serves a provider workspace with six state-derived queues, due-date sorting, history, and assigned simulation handoffs. Profile edits use the existing business record. Published profiles show only the listed services, and customers keep service context through sign-in. Request details show the relevant next action and authorized linked conversation. The shared order path, quote revisions, sender proof and business authorization were retained.

The build, 13 PostgreSQL/HTTP tests, both Chrome walkthroughs and the optional workday seed pass. Port 3100 serves the rebuilt image on the original database volume. [Test run guidebook](../TEST-RUN-GUIDEBOOK.md)

Category search, service-specific intake fields, itemized quotes, private photos, recovery, and live WhatsApp remain open. The local walkthrough has no field-pilot or public-release evidence.

### Implementation files

- Workspace and business data · `apps/marajut/{app,catalog,inquiries,provider-workspace,validation,ui-copy}.js`
- Optional workday demo · `apps/marajut/{seed,demo-workday}.js`
- Interface · `apps/marajut/views/*.ejs` and `apps/marajut/public/style.css`
- Regression coverage · `tests/workflow.test.js` and `scripts/{browser-smoke,inbound-browser-smoke}.js`
- Documentation · this assessment, `README.md`, the roadmap, and the test run guidebook

This slice uses the existing database schema. To rebuild after a later checkout, run `docker-compose up -d --wait --build` from the workspace.

## Structured work and visual update

Migration `004_structured_work.sql` adds searchable service categories, optional turnaround estimates and provider intake guidance, garment counts and fit notes for web requests, and versioned quote breakdowns. A customer can upload up to three reference photos before quoting. Each image is decoded and re-encoded to JPEG, stored in PostgreSQL, and available through an authenticated route to the customer and assigned business. The existing WhatsApp simulator uses the same itemized quote workflow.

The marketplace hero asset is `apps/marajut/public/tailor-workshop.webp`. It was generated with the built-in imagegen tool from a brief for a photorealistic close-up of a Semarang tailor guiding olive fabric through a vintage sewing machine. The brief called for a warm workshop, centered composition, and no visible lettering.

Self-service account recovery, approved real-data retention, restore rehearsal, and live messaging remain launch checks. [Test run guidebook](../TEST-RUN-GUIDEBOOK.md)

## Marketplace and workday redesign · 19 November 2026

| Surface | Observed friction | Implemented experience |
| --- | --- | --- |
| Discovery | Customers encountered an introductory CTA, a separate search form and visually similar listings. | Search starts in the opening photograph. Category links preserve the submitted search. Each service card leads to the real shop and quote request and distinguishes its initial price. |
| Tailor workday | Six equally prominent metrics competed for attention. Similar requests were hard to distinguish by service and source. | Three work queues lead into the day's list. Each request shows the customer's display name, a short description, timing, status and its next action. The remaining queues share a menu that starts collapsed on phones. |
| Shop management | At a glance, the tailor could see a service name and publication state. | Closed service rows also show category, starting price and any duration before opening the editor. The public profile and its service cards share the marketplace identity. |
| Customer follow-up | A chronological list mixed decisions, active work and completed jobs. | Customer requests are grouped by who needs to act. A live quote leads to its review section. Accepted orders show their actual production stage, including pickup and completion. |

The application serves its own DM Sans font and its license (headings use bold DM Sans; Bricolage Grotesque was removed on 25 November 2026). The spool mark, functional icons and responsive layouts are local assets. Four generated fabric close-ups illustrate service categories. Private customer photos remain scoped to their request. The queue and order changes use existing records on schema 004.
