# Source-to-target migration plan

**Status** [PROPOSAL] · 18 November 2026 WIB · [RFC-0001](../rfc/RFC-0001-MARAJUT-RECONSTRUCTION.md)

Source paths and line numbers are relative to the original archive (S4). Each legacy observation is [FACT — SOURCE] from static inspection. Each target disposition and check is proposed. **Keep/reference** retains a pattern or taxonomy after review. **Rewrite** rebuilds comparable behavior against the new model. **Replace** removes a legacy contract in favor of a different workflow. **Defer/archive** preserves evidence outside the release. Route paths below are actual legacy registrations. Target names describe new contracts.

## Routes

| Legacy route | Source | Disposition and destination | Security or regression check |
| --- | --- | --- | --- |
| GET `/api/health` | server.js:63 | rewrite → liveness and DB/schema readiness | DB unavailable changes readiness, liveness still responds, no config leakage |
| `/health` (Nginx location) | nginx.conf:87 | replace → ingress liveness forwarding | Verify distinct reverse-proxy and application/DB failures |
| POST `/api/auth/register` | server.js:77 | replace → guest verification and provider invitation | No self-assigned staff role, bounded challenge attempts |
| POST `/api/auth/login` | server.js:175 | rewrite → provider/admin session start and customer verification | Rate limit, rotate, uniform errors |
| POST `/api/auth/logout` | server.js:259 | rewrite → revoke server session | Old cookie fails after logout |
| POST `/api/auth/refresh` | server.js:267 | replace → server-side rotation and expiry | Expired or revoked cookie fails |
| POST `/api/auth/google` | server.js:328 | defer/archive → email-based identity | No Google schema or token dependency |
| GET `/api/auth/google` | server.js:436 | defer/archive → invitation or verification entry | Legacy callback surface absent |
| GET `/api/auth/google/callback` | server.js:444 | defer/archive | No browser token redirects |
| GET `/api/users/me` | server.js:467 | rewrite → private account settings | Actor-scoped response and no cache |
| PUT `/api/users/me` | server.js:516 | rewrite → scoped settings/contact changes | Fresh verification for changed identity |
| DELETE `/api/users/me` | server.js:587 | replace → revocation and governed deletion | Media purged, minimized audit retained per policy |
| GET `/api/users` | server.js:624 | replace → limited moderation/admin lookup if needed | Explicit privileged policy and field minimization |
| GET `/api/repair-requests` | server.js:671 | rewrite → own inquiries and order history | Customer isolation, pagination |
| GET `/api/repair-requests/:id` | server.js:754 | rewrite → scoped inquiry or order detail | Other customers and businesses see no record |
| POST `/api/repair-requests` | server.js:805 | replace → targeted inquiry + scoped attachment upload | Idempotency, published service binding, media validation |
| PUT `/api/repair-requests/:id` | server.js:907 | replace → explicit clarification/detail commands | Bound SQL, no arbitrary `status` edits, stale-version conflict |
| DELETE `/api/repair-requests/:id` | server.js:987 | replace → customer pre-acceptance cancel | Distinct audited state, cancellation/acceptance race |
| GET `/api/repair-requests/:id/timeline` | server.js:1457 | rewrite → filtered inquiry/order events | No internal notes or other owners' events |
| GET `/api/tailor/available-requests` | server.js:1046 | replace → assigned business inquiry queue | No global customer pool |
| GET `/api/tailor/available-request/:id` | server.js:1123 | replace → business inquiry detail | Scoped contact, images and notes |
| POST `/api/tailor/accept-request/:id` | server.js:1191 | replace → provider issues offer, verified customer accepts revision | Locks, one order and one decision, expiry check |
| GET `/api/tailor/my-requests` | server.js:1286 | rewrite → business inquiry and order lists | Active membership and scoped cursor |
| PUT `/api/tailor/update-status/:id` | server.js:1369 | replace → explicit order transition | Allowed edges, actor, prior state, atomic event |
| POST `/predict` | yolo-api/main.py:22 | defer/archive → customer description and provider review | Manual intake works with zero ML dependencies |

Route source files are under `backend-branch/`. New catalog, quote, messaging webhook, consent and outbox functionality has no corresponding verified legacy contract.

## Modules and artifacts

| Legacy source | Disposition and target | Required verification |
| --- | --- | --- |
| `backend-branch/server.js` | rewrite → application entry, route controllers and domain commands | Contract/role and fresh-start tests |
| `backend-branch/db.js`, `config/database.js` | keep/reference → pooling pattern and scoped repositories | Privileged migrations, limited runtime roles, transaction/rollback tests |
| `backend-branch/config/constants.js`, `middleware/validation.js` | keep/reference → audit repair taxonomy, create new command schemas and canonical states | Enum/limit consistency, invalid input tests |
| `backend-branch/auth.js`, `config/passport.js`, `middleware/auth.js` | replace → new session and identity module | Revocation, token replay and account-claim checks |
| `backend-branch/middleware/{index,errorHandler}.js`, `utils/dateUtils.js` | rewrite → explicit middleware composition, redacted errors and UTC timestamps/WIB display | Safe field errors, UTC and local-date tests |
| `backend-branch/init-db.sql`, `migrations/add_tailors_role.sql` | replace → ordered domain schema migrations | Empty DB and previous release upgrade, rollback/restore |
| `backend-branch/package*.json`, `.env.example`, backups and saves | replace manifests/config with pinned clean runtime and placeholders, defer/archive backups and saves | Dependency/license review and secret inventory without copying values |
| `frontend/index.html`, `indexv1.js`, nav/footer pages and `guestnav.js`, `navbarv1.js` | rewrite → original landing, provider detail and navigation | Responsive keyboard-accessible UI, no private fields |
| Frontend `loginv2.js`, `register.js`, `auth-guard.js`, `profilev2.js` and corresponding pages | replace → server-backed identity, settings and verification | No local-storage credentials, CSRF and logout |
| Frontend `forminput2.js` and `forminput.html` | rewrite → targeted intake and private image upload | No historical S3 Lambda, chatbot, Rekognition, YOLO or region credential dependency, decoder and scope tests |
| Frontend `riwayatorderv1.js`, `detailorder.js`, `detailorderreq.js`, `tailorhistory.js`, `acceptorder.js` and associated pages | replace → role-specific queues, quote and decision views, order timeline | Second tenant/customer isolation and replay tests |
| Frontend `formbayarv1.js`/payment page, `rewardpoinpage.js`/reward page | defer/archive → no payment or reward UI in P0 | Confirm workflow never presents false settlement |
| Frontend CSS and images | keep/reference → historical journey/branding inventory; fresh UI by default | Document rights and attribution for any retained asset before publication |
| `backend-branch/yolo-api/` | defer/archive → separate inference, weights and inference artifacts | No runtime build/test dependency on ML |
| `blockchain-branch/` | defer/archive → Solidity copies, Hardhat and container artifacts | No chain calls, dependencies or proof claim |
| Root/backend Dockerfiles and `docker-compose.yml`, backend Nginx config, `.github/workflows/deploy.yml`, `scripts/deploy-self-hosted.sh`, legacy deploy docs and README | replace → root Compose, one app image, one health-checked staging/hosted path and new runbook | Fresh build, migrations, secrets and recovery rehearsal |

Frontend JS and pages reside under `frontend/frontend/assets/js/` and `frontend/frontend/page/`. Static assets are covered by the rights review. Treat credential-like values in legacy Compose and browser files as potentially exposed until owners inventory their actual use and rotate active credentials.

## Data mapping

[FACT — SOURCE] S4 includes schema scripts but no verified production DB or export. [PROPOSAL] Fresh schema and synthetic seed for MVP. Any import is a separate opt-in workstream with authority to access the source and a reason to process personal data. A historical export is private and isolated.

| Legacy table or key | Disposition and target | Import rule |
| --- | --- | --- |
| `users.id`, name, email, phone, password, role | replace → `users`, `customers`, invitations and `provider_memberships` | Fresh verification and new secrets. Map legacy ID to UUID privately. Review duplicate contacts and grant no staff/admin privilege solely from legacy role. |
| `repair_requests.user_id`, `tailor_id`, categories and details | rewrite → `service_inquiries` only if customer and confirmed provider/service can be mapped, otherwise private staging/archive | Scoped validation of required fields and explicit review. Unassigned work stays outside provider views. Preserve known originals as historical metadata. |
| `repair_requests.original_img_url`, size, MIME, filenames, phone/location, AI desc | replace → `inquiry_attachments` and minimized structured intake fields | Review purpose/permission. Media only through a bounded allowlisted retrieval and re-validation from authorized storage. Exclude AI outputs and unverifiable public URLs from live data. |
| `repair_requests.estimated_cost`, status and timestamps | keep/reference → legacy estimate and status in historical snapshot | Neither estimates nor tailor claims establish quote acceptance. Never synthesize quotes, digital payments or orders. Confirm timestamp source time zone before mapping. |
| `order_timeline` | replace → domain events with explicit actor and sequence | Historical events stored separately with original label and source. Trigger actor remains historical evidence, with no verified attribution for ambiguous entries. |
| `blockchain_proofs` | defer/archive | Keep only in authorized historical export. No chain records become business truth. |

[FACT — SOURCE] `Pending`, `Order Diterima`, `Sedang Dijahit`, `Selesai Dijahit`, `Sudah Diterima`, `Dalam Pengiriman` and `Selesai` appear across legacy SQL/API with differing sets. `Selesai` may be cancellation or completion. [PROPOSAL] A verified pending record can be staged for review as an inquiry. Claimed/work-progress/collection labels remain historical unless a domain owner verifies the underlying facts and chooses a supported re-onboarding flow. Unknown labels are quarantined. Legacy IDs are never credentials, and archived rows or migrated history never trigger outbound messages.

## Execution and cutover

1. Reconfirm hash and scope, inventory reused items in the new provenance record, review dependencies, rights and secrets. Set up target migrations, seed and restore checks on a clean DB. Treat baseline integrity as verified and dependency/security due diligence as open.
2. For any authorized import, capture source schema/version and make an encrypted read-only snapshot. Dry-run into a restricted staging DB. Upsert staging rows keyed by baseline/table/legacy ID. Run duplicate, referential, missing ownership, unknown-status, media provenance and timestamp checks, producing counts only in shareable reports.
3. Review quarantined records with the data owner, verify safe mapping and sample actual histories privately, reconcile original and staged totals, approve import scope and preserve a report. Run a repeat dry-run to prove idempotency. Keep notifications and public access disabled for staged data.
4. Cut over to the new release only after fresh migration and E2E acceptance, privacy controls, tested restore, and signed-off deployment. If replacing a real writable deployment later, schedule a read-only window or delta replay with reconciliation and explicit reverse path before opening target writes. There is no verified production cutover obligation for the ZIP. Keep the original snapshots unchanged and remove unnecessary staging copies on approval.
5. Roll back the release image if schema compatibility is intact. Otherwise use the predeploy snapshot and an approved recovery/replay plan for post-cutover writes. Keep the prior release isolated if its known privacy controls are insufficient. Do not resume outbound work before checking consent and dedupe on the restored state.

[Prioritized slices and evidence gates](../roadmap/MARAJUT-IMPLEMENTATION-ROADMAP.md)

