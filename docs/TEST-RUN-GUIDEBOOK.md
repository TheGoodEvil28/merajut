# Marajut test run guidebook

Update this guide with every change. Record the affected roles, prerequisites, steps, expected results, verification method, and any unverified behavior.

## RFC-0004 pilot reporting and OpenWA dispatch plan · 26 November 2026 WIB

**Roles and setup.** Use separate admin, customer, and existing tailor sessions, plus a synthetic partner who replies through a fixture chat. Maintainers need Node 22, Docker Compose, Playwright Chromium, and a disposable database. After implementation, start a fresh sandbox with `DISPATCH_WHATSAPP_MODE=mock` and seed one opted-in group and partner, a partner without opt-in, and managed requests for both. Use the sandbox and browser commands from the pilot readiness check. [Sandbox setup](../README.md#rehearse-in-a-fresh-demo) · [Roadmap](roadmap/MARAJUT-IMPLEMENTATION-ROADMAP.md#next-update--26-november-2026-wib) · [RFC-0004](rfc/RFC-0004-MARAJUT-PILOT-REPORTING.md)

| Check | Steps | Expected result |
| --- | --- | --- |
| Reporting | Create requests, first quotes and revised quotes, and verified payments on either side of midnight WIB. Open **Kinerja layanan**, select each period, and reload. | The range and first-quote median match the fixtures. Request and payment dates use their respective boundaries. Live and test commission remain distinct. |
| Admin dispatch | Open **Koordinasi penjahit** as admin, inspect each preview, and confirm the group and direct actions. Submit one confirmation twice, then try a stale preview and the partner without opt-in. Revoke opt-in before the worker claims a seeded job. | One mock message per approved channel reaches the fixture gateway. Previews contain the allowed fields and the status shows **Simulasi WhatsApp**. Stale or unapproved work yields zero sends. |
| Recovery and signed inbox | Return a safe pre-send failure and then an ambiguous timeout from the fixture gateway. Restart the worker with a leased job. Post a callback with a bad signature, duplicate and reordered valid receipts, and a reply with and without the order reference. | Only the safe failure retries with the same key. The admin can resolve the timeout in **Perlu diperiksa**. Each valid effect is applied once, receipt progress stays intact, and a reply without clear context goes to admin review. |
| Customer and tailor regression | Run the three browser walks from [pilot readiness](#rfc-0002-pilot-readiness--26-november-2026-wib) with separate sessions. Repeat the customer quote accept/decline, fitting, demo checkout and history. Repeat existing tailor sign-in and business-scoped views, and try to open the admin dispatch route from both sessions. Switch off the mock and exercise the admin's manual flow. | Customer order status and checkout follow the existing workflow. The tailor sees their own shop data. The admin can use manual WhatsApp links and record availability, and both other roles are denied access to dispatch messages. |
| Authorized gateway | After the pilot approvals, repeat one group and one direct send on the pinned OpenWA deployment and ask the approved partner to reply with the request reference. Restart the gateway and compare both chats with the admin timeline. | The group and direct destinations match, the session resumes, verified direct delivery and the reply appear on the correct request, and consent and outcomes are recorded. |

**Checks run for the draft.** Reviewed the existing management routes, dispatch and reassignment rules, outbox schema and worker, quote and payment records, and private preview setup. Cross-checked OpenWA 0.32.1 send, key scope, signature, webhook and deployment contracts against upstream documentation. Checked changed Markdown links, anchors, and whitespace.

**Pending verification.** All RFC-0004 runtime and browser checks in the table are implementation acceptance tests. Gateway restart, actual delivery, and replies require the authorized pilot setup.

## RFC-0003 private preview and pilot · 26 November 2026 WIB

Use Docker Compose with Linux containers, Node 22, Playwright Chromium, and an isolated synthetic database. Prepare separate tester and QA gate credentials and three Marajut demo sessions for the customer, admin, and existing tailor. The maintainer uses the `preview` command and project name from the README. [Preview setup](../README.md#run-a-private-https-preview) · [RFC-0003](rfc/RFC-0003-MARAJUT-PRIVATE-PREVIEW-AND-PILOT.md)

| Check | Steps | Expected result |
| --- | --- | --- |
| Preview access | Run `preview config --quiet`, build, start, and seed a fresh preview. Open the HTTP app URL, then the HTTPS app and mailbox in fresh sessions. Try the tester login at both gates and the QA login at the mailbox. | HTTP redirects to HTTPS. A fresh session receives a login challenge. Testers can reach Marajut, and QA can reach its test mailbox. The proxy is the only published service. |
| VM access for invited testers | Set both DNS names and allow TCP 80 and 443 on the VM. From another network, open the app over HTTP, follow the redirect, and sign in with a tester gate account. Open the mail hostname with the same login, then with the QA login. Complete a synthetic customer signup and have QA relay its verification code. | Both hostnames use trusted certificates. The app opens for a tester. The mailbox returns an authentication challenge for the tester and opens for QA. The customer can sign in with the verified signup. |
| Sessions and client limits | Sign in to Marajut from two clients on different networks or addresses and compare their login rate-limit headers. Sign in as the second demo customer and open a known order owned by the first. | The HTTPS session cookie is Secure and HttpOnly. Each client has its own allowance. The order is available only to authorized roles. |
| Order journeys | Run the three loopback smoke commands below. On a hosted preview, repeat the tasks manually from an invited session. | Customer, admin, and existing tailor sign-ins work. Delivery with fitting and payment retry, simulated chat handoff, and verified guest pickup complete. Account verification and recovery email links open at the canonical HTTPS origin. |
| Restart recovery | Check readiness and the admin's **Operasional** heartbeat, run `preview restart web worker`, then check both again. | The authenticated readiness route returns 200 and the worker heartbeat advances after restart. Existing requests and order history remain readable. |
| Encrypted restore | With `MARAJUT_BACKUP_PASSPHRASE` in the process environment, run `node --env-file=.env.preview scripts/db-backup.js save marajut-preview-qa <backup-file>`. Then run `node --env-file=.env.preview scripts/db-backup.js rehearse marajut-preview-qa <backup-file> <request-uuid>`. Use the project name for the running preview and the full UUID from a known completed order's request URL. | Counts match the preview. The order read model opens the restored request and reports its status and event types. The rehearsal database is removed afterward. |

For the loopback smoke, run `preview cp proxy:/data/caddy/pki/authorities/local/root.crt .preview-secrets/preview-root.crt` and set `NODE_EXTRA_CA_CERTS` to that file's absolute path. Set `APP_ORIGIN=https://localhost:3170` and `MAIL_ORIGIN=https://127.0.0.1:3170` for the example ports. Supply the tester's `PREVIEW_APP_USER` and `PREVIEW_APP_PASSWORD`, and the QA mailbox's `PREVIEW_MAIL_USER` and `PREVIEW_MAIL_PASSWORD` from the private configuration. The smoke scripts accept loopback origins.

```sh
node --env-file=.env.preview scripts/browser-smoke.js
node --env-file=.env.preview scripts/inbound-browser-smoke.js
node --env-file=.env.preview scripts/pilot-browser-smoke.js
```

**Checks run.** Built the preview from a disposable snapshot of `e6357e9` with the RFC-0003 changes applied. Rendered the VM configuration with two sample DNS names and verified Caddy-only bindings on ports 80 and 443, the private database network, and simulated payment and messaging. The Caddy configuration passed validation. Started a separate HTTPS preview on port 3193 with redirects on 3194. Verified the certificate, both access gates, and Secure and HttpOnly sign-in cookies. All 22 integration tests and all three customer, admin, and tailor browser walkthroughs passed. An earlier loopback rehearsal also verified cross-customer denial and independent login allowances for two clients.

Restarted the HTTPS web service and worker. Readiness returned 200 and the heartbeat advanced. The encrypted restore matched 8 accounts, 10 requests, 7 orders, 28 order events, and 2 photos. The order read model opened a completed order and returned its quote, payment, and completion history.

**Pending verification.** Check public DNS, certificate issuance for both VM hostnames, and invited access from another network after the VM is deployed. Participant observation, merchant sandbox, and official WhatsApp checks still need their respective access and approvals.

### Pilot rehearsal

1. Recruit consenting testers for the customer, admin, and tailoring partner tasks. Use synthetic orders and record the preview revision and device for each session.
2. Have the customer request a quote and fitting. Have the admin prepare the WhatsApp group and private drafts, record the agreed reply, and issue the quote. The tailoring partner reviews the draft and replies with availability and timing. Use a second order to cover the other handover method.
3. Record the role, screen, result, assistance needed, and time from request to issued quote. Use the order timeline for the two timestamps. Summarize the sample size and prioritize the issues that blocked a task.
4. Before a real-data pilot, assign the support owner and record the agreed contact and photo retention and deletion process. Keep hosting, merchant sandbox, official messaging, and competition evidence with their respective approval records. [Authentication and retention](adr/ADR-0007-authentication-and-retention.md) · [Competition requirements](adr/ADR-0009-competition-eligibility.md)

## RFC-0002 pilot readiness · 26 November 2026 WIB

Use separate customer, admin, and existing tailor sessions. The maintainer needs Node 22, Docker Compose, Playwright Chromium, two unused loopback ports, and synthetic `POSTGRES_PASSWORD` and `DEMO_PASSWORD` values. Start from an isolated checkout containing the RFC implementation. [RFC-0002](rfc/RFC-0002-MARAJUT-PILOT-READINESS.md) · [Sandbox setup](../README.md#rehearse-in-a-fresh-demo)

| Step | Reproduce | Expected result |
| --- | --- | --- |
| Fresh demo access | Run `npm ci`, `npm run build`, and `node scripts/sandbox.js 3166 3167`. Use the printed project name and app URL. Check `/health/ready`, then sign in as the customer from a listing, as admin, and as the existing tailor in separate sessions. Open **Operasional** as admin. | The app returns 200, the worker has a recent heartbeat, and the sandbox uses simulated messaging and checkout. The customer resumes the chosen service, the admin sees **Papan pesanan**, and the tailor reaches their assigned workspace. |
| Seed rerun | Use `docker compose -p <project> run --rm seed npm run db:seed -- --workday` for the same sandbox. Compare account IDs, requests, orders, and order history before and after. | Fixture sign-ins work with that sandbox's demo password. Existing records and their ownership match. |
| Follow-up | Request a fitting change as customer. As admin open **Papan pesanan → Perlu tindak lanjut**, search the order code, and open the matching row. At 360 px use Enter on **Antrean** to reveal the filter. Run the integration suite for complaints, expired fitting proposals, late accepted work, and page boundaries. | The row shows its fitting reason and WIB date and opens **Jadwal fitting**. Search and page results agree with the count. Resolving a reason drops the order from follow-up or reveals its next qualifying reason. |
| Checkout recovery | Mark an order ready, start a demo payment, and record a failed attempt as admin. Retry as customer and verify payment before completing pickup or recording delivery. Use the gateway fixtures for a lost charge response, a status timeout, an expired bill, and repeated settlement. | The accepted total stays the same. Errors appear in **Pembayaran**. A pending attempt can be reloaded or checked, and a failed attempt can be replaced. Verified payment contributes once to commission and unlocks handover. |
| Rehearsal and restore | Run `docker compose -p <project> run --rm test`. Set `APP_ORIGIN`, `MAIL_ORIGIN`, and `DEMO_PASSWORD` for the sandbox. Run `node scripts/browser-smoke.js`, `node scripts/inbound-browser-smoke.js`, and `node scripts/pilot-browser-smoke.js`. Follow [T10](#t10--backup-and-retention-rehearsal) to save and restore the backup. | The integration suite and the order, inbound chat, and guest pilot walkthroughs pass. The restore reports matching accounts, requests, orders, order events, and photos. |

**Checks run.** Installed dependencies in a fresh source snapshot and ran the build, Compose configuration check, and sandbox on ports 3166 and 3167. Verified readiness, the simulated modes, and the worker heartbeat. A seed rerun matched the account, request, order, and order-history records. All 22 PostgreSQL and HTTP tests and all three Chromium walkthroughs passed. Coverage included search-scoped counts across 27 follow-up orders, keyboard operation of the mobile menu, role and photo access, payment recovery, and both pickup and delivery. The encrypted restore matched 8 accounts, 10 requests, 7 orders, 28 order events, and 2 photos.

**Publication preflight.** Repeated the JavaScript build, Compose configuration check, and whitespace check. The implementation and test files matched the successful rehearsal snapshot. With GitHub write access, stage the RFC changes, run `git diff --cached --check`, push `main`, and compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/main`. The two hashes should match and the Actions run should pass for that commit.

**Pending verification.** A private HTTPS preview needs a host and an isolated database. A merchant sandbox transfer, official WhatsApp delivery, and a field pilot remain external checks. Competition submission follows the separate eligibility decision. [Competition requirements](adr/ADR-0009-competition-eligibility.md)

## Marajut naming and SEVENT X verification · 26 November 2026 WIB

**Roles and setup.** Use a guest, customer, tailor and platform admin against a disposable Marajut database. Maintainers can repeat the upgrade and restore checks. Copy `.env.example`, set synthetic passwords and choose unused loopback ports. Build once with `docker compose -p marajut-naming-qa build web`, start with `docker compose -p marajut-naming-qa up -d --wait --no-build` and run `docker compose -p marajut-naming-qa run --rm seed npm run db:seed -- --workday`. Use `docker-compose` where that is the installed command.

| Step | Action | Expected result |
| --- | --- | --- |
| Repository and screenshots | Search current filenames and file contents for the former branding, including hidden files. Inspect the archived screenshots and storefront images with OCR and check local image links in Markdown. | Current files use Marajut. Archived images with the previous wordmark are gone, and all retained image links resolve. The competition record gives the earlier entry and archive checksum in neutral terms. |
| Branding and sign-in | Open the local marketplace and `/health/ready`. Sign in separately with `customer@marajut.test`, `operator@marajut.test` and `tailor@marajut.test` and the stack's demo password. | Readiness is 200. Marajut is used in the app, package, worker output, account mail and demo addresses. The customer, admin and tailor each reach their own workspace. |
| Role regressions | Set `APP_ORIGIN`, `MAIL_ORIGIN`, `DEMO_PASSWORD` and `BROWSER_CHANNEL=chrome` for the disposable stack. Run `node scripts/browser-smoke.js`, `node scripts/inbound-browser-smoke.js`, `node scripts/pilot-browser-smoke.js` and `docker compose -p marajut-naming-qa run --rm test`. | The customer completes fitting, simulated payment and delivery, the admin records the workflow, and an existing tailor retains scoped access. Guest verification, quote revision, pickup and simulated chat conversion work. |
| Mobile order menus | Install Playwright Chromium with `npx playwright install chromium` and run `node scripts/browser-smoke.js` with `BROWSER_CHANNEL` unset. The walkthrough resizes the tailor view to 360 px and the admin order board to 375 px. | The tailor queue menu and admin order filters collapse after the resize. Opening each menu allows the walkthrough to select a queue or the payment filter. |
| Database upgrade | On synthetic data at migration 007, record the IDs and related records for the five original demo accounts. Apply migration 008 twice. Repeat with an occupied address, a role mismatch and an unrelated address. On a separate snapshot, rerun with the previously recorded 008 checksum, then try an unexpected checksum. | Eligible demo addresses change in place with their UUIDs, password digests, memberships and orders intact. Existing owners and unrelated accounts keep their addresses. The migrator accepts the approved 008 checksums and rejects an unrecognized checksum. |
| Backup and rehearsal | Set `MARAJUT_BACKUP_PASSPHRASE` and run the backup and restore rehearsal below on the isolated Compose project. Check both the current format and a synthetic file with the prior format. | Both encrypted backups authenticate and restore into a temporary database. The report gives the same schema and fixture counts for both. |
| Competition documents | Compare the [eligibility checklist](adr/ADR-0009-competition-eligibility.md#sevent-x-website-checklist) with pp. 9–11 and 14 of the supplied rulebook. | The checklist identifies the chosen subtheme, prior-work disclosure, tested functionality and remaining submission materials. |
| GitHub publication | With write access to `origin`, run `npm.cmd run build`, `docker-compose config --quiet` and `git diff --cached --check`. Validate the staged files and use Marajut in the commit title and description. Push `main`, then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/main`. | The checks pass, local secrets and backup files stay outside the commit, and both hashes match. |

**Checks run.** Built the image from the renamed source with `npm ci`, started the separate Compose stack on ports 3164 and 3165, and confirmed readiness and Marajut startup logs. JavaScript syntax and Compose validation passed. All 21 integration tests and all three Chrome smoke paths passed, including the pilot's automated axe checks. A separate 007-to-008 upgrade test verified unchanged customer and tailor IDs, password digests, history and memberships, an occupied-address case, and sign-ins using the new addresses. Both backup formats restored seven requests and four orders at schema 008. GitHub repository metadata confirmed public visibility.

**Naming cleanup checks.** Ran `npm.cmd run build`, all 21 PostgreSQL and HTTP tests, and all three Chrome walkthroughs on the new isolated stack on ports 3166 and 3167. Fresh and previously applied migrations passed in disposable schemas. The five accounts kept their UUIDs, password digests, order history and memberships. Role mismatches and address conflicts stayed intact. Unexpected checksums for 001 and 008 were rejected. Both encrypted backup formats restored ten requests, seven orders and two photos with matching byte counts. Scanned current file contents, filenames and Markdown image links. OCR identified ten archived screenshots for removal and found no remaining matches in the retained screenshots or storefront WebP assets. Existing hosted builds and Git history were outside the verification scope.

**Publication preflight.** Repeated the JavaScript build check, Compose validation and staged whitespace check. The staged filename and content scan passed. The local environment file remained ignored and the staged tree contained no database backups or key files.

**Responsive browser follow-up.** The first GitHub Actions run checked the admin filters before the resize handler collapsed them. The smoke test now waits for the closed state on the tailor queue and admin filters before opening each menu. All three browser walkthroughs passed with Playwright Chromium against fresh synthetic data on ports 3166 and 3167.

**Unverified for submission.** Written organizer eligibility clearance, roster and registration evidence, an externally reachable deployment, proposal and signed originality form, and the final YouTube demo remain pending. Live WhatsApp delivery and live payment settlement were outside the synthetic rehearsal.

## Customer and admin order walkthrough · 26 November 2026 WIB

**Roles and prerequisites.** Use a guest, customer, platform manager, and an existing tailor in separate browser sessions. Use a disposable database with migration `007_order_followthrough.sql`, seeded accounts, the worker, and `PAYMENT_MODE=demo`. The optional `--workday` seed adds orders at different stages, including a fitting appointment. Use synthetic contact details and inspect WhatsApp drafts before returning to the order.

| Step | Action | Expected result |
| --- | --- | --- |
| 1. Estimate and preferences | Open a service with a Rp25.000 starting price and select two garments. Choose fitting and delivery. Submit, then add a reference photo. | The form and saved request show a Rp50.000 estimate. The customer sees the order code, current stage and next action. The admin sees the preferences and can open the private photo. |
| 2. Find and coordinate | As admin, open **Pesanan**. Filter **Koordinasi** and search by the short order code, customer name or tailor. Open the request. Inspect the WhatsApp group draft and private link, then record contact and the tailor's availability. | The queue shows counts, customer names and next steps. Search and filters can be used together. On a phone, the **Antrean** disclosure expands the filters. Group drafts omit customer details. Recording the reply advances the order to quote preparation. |
| 3. Ask for details and quote | Ask for a clarification under **Tindakan lain**. Answer as customer. Enter price lines, an estimated completion date, delivery and a fitting time and location. Send the offer. | The question and answer appear on the order. The customer sees the negotiated total and schedule above secondary details. Delivery is preselected from the request. The customer can approve, request a revision, or decline. |
| 4. Decline or revise | On a separate request, decline the quote or record an unavailable tailor. Choose another service and inspect both requests. For a price change, use **Minta penyesuaian** and issue a revised offer. | The replacement request keeps the brief, preferences, and photos. The original quote stays in its history. A revision requires the customer to review the new offer. |
| 5. Change the fitting | Accept an offer with a fitting. Select **Minta jadwal lain**. As admin, propose a new time and location. Confirm it as customer, then record the finished fitting as admin. | The new time appears in WIB and waits for confirmation. The agreed price stays the same. **Tandai jahitan siap** becomes available after the fitting is recorded as finished. |
| 6. Pay and hand over | Start work, mark it ready, and simulate payment as the customer. As admin, open the **Pembayaran** queue and verify the amount. For delivery, record the courier or tracking information and finish after receipt. For pickup, finish after the handover. | The customer sees when to pay, when payment is verified, and whether their clothes are ready for pickup or in transit. Delivery cannot be recorded before payment. Completed orders appear in both histories. |
| 7. Directory, reports, and existing orders | Navigate to **Mitra**, **Kinerja**, and **Operasional**. Publish a synthetic shop and open the public listing. Open a managed order as its assigned legacy tailor and repeat a pre-006 cash order in the legacy test schema. | Admin tasks have separate pages. The directory protects the private number from storefront visitors. The tailor can view assigned managed work and still complete pre-006 orders through the legacy flow. |

**Checks run.** JavaScript syntax and Compose configuration passed. The Express/PostgreSQL suite passed all 21 tests with separate legacy and managed schemas. It checked reassignment, preserved intake preferences, role checks, stale fitting updates, fitting completion before checkout, payment failure and retry, replay-safe settlement, and recording shipment before handover. A separate upgrade test applied migration 007 twice to a schema at 006 and preserved five existing order states, their accepted prices and quotes, and a legacy cash receipt. It verified the fitting backfill for open and already finished work.

**Browser checks.** Repository Chrome smoke scripts covered the customer and admin delivery flow with fitting rescheduling, the pickup flow with guest verification and a revised quote, simulated inbound conversion, and the existing tailor dashboard. They checked customer order and admin report widths at 320, 375 and 768 px, keyboard and responsive checks on shared navigation, and the pilot's automated axe checks. Browser automation ran against a disposable app, worker, database and mailbox. The separate Compose preview uses its own data volume. Both synthetic sign-ins were verified on the preview. The admin opened the order queue and the customer saw the seeded fitting appointment.

**Unverified.** Actual WhatsApp messages, physical fittings and handover, clipboard behavior on a real payment page, and live Midtrans settlement remain outside this rehearsal. Gateway tests used fixture responses.

## Admin-managed tailoring orders · 25 November 2026 WIB

Use this scenario for new orders. The older tailor-operated quotation and cash scenarios below cover requests already in progress when migration 006 was applied.

**Roles and setup.** Use a guest, a customer, the platform manager and a legacy tailor in separate browser sessions. Use a disposable PostgreSQL database with migrations through `006_managed_orders.sql`, a worker, synthetic seed data and `PAYMENT_MODE=demo`. With the local Docker prerequisites below, `node scripts/sandbox.js 3156 3157` creates a separate app and mailbox on those ports. Use available ports if those are occupied. Use `customer@marajut.test`, `operator@marajut.test` and `tailor@marajut.test` with that stack's `DEMO_PASSWORD`. Use synthetic contact data and inspect WhatsApp drafts locally during rehearsal.

| Step | Action | Expected result |
| --- | --- | --- |
| 1. Partner registration | As a guest, open `/mitra/daftar` and submit a synthetic business, service area, specialty and WhatsApp number. As admin, open **Mitra penjahit → Kelola profil dan layanan**. Alternatively, use **Tambah mitra** to enter a partner directly. | The admin can review a private draft without creating a tailor login. Repeating the same public registration leaves one draft. |
| 2. Marketplace | Complete the partner profile, add an active service and estimate, then publish with the manager password. Open the public listing. | Customers see the service, specialty, starting price and completed-order count. The private coordination number stays on the admin side. Hiding the listing removes it from discovery. |
| 3. Customer intake | Update **Profil saya**, choose a service with a Rp25,000 estimate, request two garments and add a reference photo. | The request shows an initial Rp50,000 estimate. The admin sees the request in **Papan pesanan → Koordinasi mitra**. Checkout opens later. |
| 4. Dispatch | Open the request as admin. Inspect **Bagikan ke grup WhatsApp** and the private WhatsApp link. Record a group post, then **Mitra sudah dihubungi**. Record **Mitra bersedia** after agreement. On a second request, record **Mitra berhalangan**. | The group draft contains a work reference and service. The private draft includes the brief. The admin records what happened in WhatsApp. Each update appears in the timeline. An unavailable partner can be replaced. |
| 5. Quote and change of tailor | Enter price lines, a completion date, optional fitting time and place in WIB, and pickup or delivery. Decline as the customer and select a service at another shop. Open both linked requests. | The original keeps its rejected quote. The replacement receives the brief and photos and starts a new availability check. The first tailor cannot open the replacement. |
| 6. Accept and track | Record the replacement tailor's availability, publish a new quote and accept it as the customer. Start work as admin and then mark it ready. | The accepted price, ETA, fitting details and handover choice appear on the order. The customer can track progress in **Pesanan Saya**. A legacy tailor can view their assigned managed order and service performance. Admin handles its workflow updates. |
| 7. Payment | Start a demo payment from the ready order. As admin use **Pembayaran** to open the order. Try a failed payment, retry as the customer, then verify it and complete handover. | Handover completion requires verified payment. With the default 5% commission, Rp80,000 yields Rp4,000 for the platform and Rp76,000 for the partner. Repeated verification counts the payment once. Demo commission appears under **Komisi uji**. |
| 8. History and complaint | Open the completed request from customer history. Submit a complaint. As admin, open **Keluhan terbuka**, record the resolution and inspect **Kinerja layanan**. | Both roles see the outcome and the service's completed count increases. The public profile exposes only the aggregate completion count. |

**Regression commands.** Run `npm run check` and `npm test` with `MARAJUT_ENV=test` and the disposable PostgreSQL connection variables set. For browser tests set `APP_ORIGIN`, `MAIL_ORIGIN` and `DEMO_PASSWORD` for the same disposable app, worker and mailbox. Use `BROWSER_CHANNEL=chrome` for installed Chrome. Run `npm run test:browser`, `npm run test:inbound-browser` and `npm run test:pilot-browser`.

**Checks run.** The Express/PostgreSQL suite passed all 21 tests with separate legacy and managed schemas. The managed test registered and published an accountless partner, updated a customer profile, rejected and reassigned a quote, accepted a delivery with a fitting, and verified commission and complaint resolution. Gateway fixtures exercised a lost charge response, simultaneous retries, expiry and replacement, signature and amount validation, duplicate settlement and role restrictions. The three Chrome smoke scripts ran against a disposable web server, worker, database and mailbox. They covered mobile customer checkout, the existing tailor dashboard and read-only managed order, admin quote revision, guest verification, simulated payment, customer history, inbound chat conversion and the pilot accessibility assertions. JavaScript syntax and Compose configuration were checked.

**External checks outstanding.** WhatsApp draft destinations and message contents were verified. Sending a message to a real group or partner and receiving their reply require a WhatsApp session. Midtrans was exercised with fixture responses. A merchant sandbox transfer and externally delivered notification still need merchant credentials and a reachable callback URL. Real fund collection, partner disbursement and physical fitting or delivery were outside the rehearsal.

Before publishing to GitHub, the JavaScript syntax check, Compose configuration validation, and all 21 automated tests passed again against the disposable QA database. The three Chrome workflow results above are from implementation verification.

## Before testing

- Open [Marajut](http://127.0.0.1:3100/) and check [readiness](http://127.0.0.1:3100/health/ready). Use the port configured for the stack under test. The account table below uses the current demo addresses.
- From the project directory, start a stopped local app with `docker-compose up -d --wait`. To refresh it after source changes, run `docker-compose up -d --wait --build`. For fixture accounts, run `docker-compose run --rm seed`.
- To demonstrate several tailor work states on a **disposable demo database**, run `docker-compose run --rm seed npm run db:seed -- --workday`. The examples are marked as demo and use ordinary domain commands. Repeating the command leaves those existing examples in their current state.
- Use separate Chrome profiles or regular and private windows for each role. Fixture accounts use the local `DEMO_PASSWORD`. Give a new request a unique synthetic tag.

| Account | Role |
| --- | --- |
| `customer@marajut.test` | Customer for the web request |
| `tailor@marajut.test` | Jahit Rina tailor |
| `customer2@marajut.test` | Customer for simulated WhatsApp |
| `tailor2@marajut.test` | Ruang Jahit Dewi tailor |
| `operator@marajut.test` | Platform manager for dispatch, payments, catalog and triage |

## Dev mode: native app with auto-restart (Postgres and MailCatcher in Docker)

Affected roles: none in behavior; this is a developer workflow for all roles. It runs beside, not instead of, the full Docker stack above.

Prerequisites: Docker, Node 22+, a `.env` with `POSTGRES_PASSWORD` and `DEMO_PASSWORD`. Create a gitignored `.env.dev` with `MARAJUT_ENV=local`, `PGHOST=127.0.0.1`, `PGPORT=5433`, `PGUSER=marajut`, `PGDATABASE=marajut`, `PGPASSWORD` (same value as `POSTGRES_PASSWORD`), `DEMO_PASSWORD`, `PORT=3100`, `BIND_HOST=127.0.0.1`, `APP_ORIGIN=http://localhost:3100`, `MESSAGING_MODE=simulated`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`. Stop the Docker `web` and `worker` services first if running, since they use port 3100.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | `docker compose -f compose.yaml -f compose.dev.yaml up -d --wait db mail`, then `npm ci`. | `db` (127.0.0.1:5433) and `mail` (UI 3101, SMTP 1025) are healthy. |
| 2 | `npm run dev:migrate`, then `npm run dev:seed`. | Migrations 001–005 apply and fixture accounts are ready. |
| 3 | In two terminals run `npm run dev` and `npm run dev:worker`. | Web logs `Marajut listening`. Worker logs `Marajut worker started`. `/health/ready` returns 200. |
| 4 | Edit a source file under `apps/marajut/`. | Node restarts the process automatically. This is a server restart, not browser hot reload, so refresh the page. EJS views are re-read on request in non-production only if Express view caching is off; if a view change does not show, restart. |
| 5 | Sign up as a guest and open [MailCatcher](http://127.0.0.1:3101/). | The verification email arrives. It uses the `SMTP_HOST` and `SMTP_PORT` override in `apps/marajut/mail.js`, which applies only in local and test environments. Docker-only runs still default to host `mail`, port 1025. |

Checked in this change: migrate, seed, web start, worker start and heartbeat row, and `/health/ready` returned 200 on the native app. Not verified: automatic restart on file edit, EJS caching behavior, the MailCatcher email path from the native app, the customer and tailor regression paths T1 and T2, and the full Docker build. The first `docker compose up --build` failed when several services tried to create the same image tag in Docker Desktop. It is unresolved, so rerun it or build once with `docker compose build web` before `up`. `npm test` was not run.

## T1 · Customer discovery and tailor order

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Signed out, open **Cari Penjahit**. Select **Jahit Rina**, then **Minta penawaran** for **Permak panjang pakaian** (**Hem adjustment** on older seeds). Choose **Masuk ke akun** in the request form and sign in as the customer. | The public profile shows its published services. Sign-in returns to **Minta penawaran** with the chosen service selected. |
| 2 | Enter a tagged request and choose **Kirim permintaan**. In a separate profile sign in as the Jahit Rina tailor and open **Ringkasan → Permintaan masuk**. | The request appears with **Situs web** as the source. The corresponding count includes it. The customer sees what happens next. Capture the dashboard at 360 and desktop widths. |
| 3 | Open **Klarifikasi atau tutup permintaan**. Add a note and choose **Minta klarifikasi**. As customer, open the request and send a response. | The tailor sees **Butuh klarifikasi** until the customer replies, then the request returns to the incoming review queue. |
| 4 | Send a quote, optionally send a revision, and ask the customer to accept the current version. | It moves through **Menunggu persetujuan** to **Pekerjaan aktif**. The agreed amount comes from the accepted revision. A stale revision is rejected by the API. |
| 5 | Select **Mulai pengerjaan**, **Tandai siap diambil**, then **Selesaikan pesanan**. Refresh the customer view. | The dashboard moves the work through **Siap diambil** and **Riwayat**. The customer sees **Selesai** and the actor/timestamp history. Capture the completed order. |
| 6 | Sign in as the other tailor. Check the workspace and open the private request URL from step 2. | Their counts omit it and direct access returns **Halaman tidak tersedia**. |

## T2 · WhatsApp handoff inside the workspace

1. As `customer2@marajut.test`, open **Pesanan Saya → Simulasi WhatsApp**. Send a simulated message, choose **Ruang Jahit Dewi · Perbaikan jahitan lepas** (**Seam repair** on older seeds), and send tailoring details. Use **Muat ulang** after submitting delayed events.
2. If needed, choose **Tautkan pengirim**, send the proof and complete **Konfirmasi tautan** in the same session. The draft becomes available. Select **Minta bantuan penjahit**.
3. As `tailor2@marajut.test`, open **Ringkasan → Chat WhatsApp · simulasi**. Check the conversation source label, open it, select **Tangani percakapan**, and send a reply. The customer sees a **Balasan simulasi**.
4. Choose **Buat permintaan layanan**. The request shows **Percakapan terkait**. Send a quote and have the customer accept it from their own account. Return to the conversation and choose **Selesaikan percakapan**. It leaves the tailor queue and the customer sees the resolved conversation.
5. Try the active conversation URL as Jahit Rina. Expect denied access and no other-business counts. WhatsApp is simulated throughout this path.

## T3 · Services and public visibility

1. As Jahit Rina, open **Layanan Saya**. Add a synthetic service as **Disembunyikan**, then edit its price and reload. It remains visible to its owner and absent from customer discovery and the other tailor's list.
2. Set it to **Ditampilkan**. On the public profile verify the name, description and **Mulai dari** price. Hide it again and verify the listing and new request entry disappear.
3. If an older request already exists for that service, reopen it and verify the same private history remains accessible to its participants.

## T4 · Public business profile

1. In a disposable demo, open **Profil Usaha** as Jahit Rina. Change the business name, area and story. Select **Simpan profil**. The success message appears and the values persist after reload.
2. Open **Lihat profil publik**. Check the new fields and verify the same name and area in **Cari Penjahit**. The page displays deliberately public fields and visible services.
3. Reopen Ruang Jahit Dewi's public profile and verify it remains separate. A customer attempting to change a profile receives an authorization error.

## T5 · Service filters, structured requests, and itemized quotes

1. Restart with the current Docker image and seed a disposable database. As Jahit Rina, open **Layanan Saya**, choose **Permak & ukuran**, set a duration such as four days and enter a customer hint. Save the visible listing.
2. As a guest or customer, open **Cari Penjahit**. Search for the service or filter by category. Verify the card shows the category, duration, and starting price. Try a search with no matches and clear the filters.
3. Choose **Minta penawaran**. Verify the selected service hint, enter two garments and a fit note, then submit. Open the request as the tailor. Verify both structured values appear.
4. In **Buat penawaran**, enter two garments at Rp15.000 each. Add a material at Rp2.500. Verify the preview total is Rp32.500 and send the quote. As the customer, verify the item list, quantities, prices and total. Accept the latest revision. Verify **Detail pesanan** records the same items, total, and accepted version.
5. Repeat with a revised price before acceptance. Verify **Versi sebelumnya** preserves the earlier breakdown. The API must reject stale acceptance, a mismatched submitted total, and access by an unrelated account.

## T6 · Private reference photos

1. As the customer, open a new request and upload a synthetic JPEG, PNG, or WebP under **Foto referensi**. Verify the thumbnail appears and the assigned tailor can open it.
2. Open the copied photo URL signed out, as the other customer, and as the other tailor. Expect access denied. The title and public catalog must show no private attachment.
3. Try a corrupt image, a file over 3 MB and a fourth attachment. Verify each is rejected. Use **Hapus foto** as the owner before the quote to remove one. After the tailor issues a quote, verify existing photos remain visible to both participants and upload controls are unavailable.
4. At 360 px, check visible focus and readable field labels. At desktop width, check the catalog photograph, filters, the item editor and the completed-order breakdown. The simulator flow should still produce a quote and accepted order.

## T7 · Marketplace, workday and order tracking

Use a seeded disposable Docker project, a customer and the Jahit Rina tailor in separate sessions. Include the optional workday seed to see several queues at once. Use a synthetic description that makes your request easy to recognize.

| Role | Steps | Expected result |
| --- | --- | --- |
| Guest | Open the home page at 360 px and at desktop width. Press Tab from a fresh load. Search for an unmatched term, choose **Permak & ukuran**, then **Hapus filter**. Select the category again. | Sign-in stays on the wordmark row. The first keyboard stop is **Lewati ke konten**. Category links keep the submitted search term, show the current category and lead straight to results. Clearing filters restores available listings. |
| Customer | Select a tailor from a service card, then **Minta penawaran**. Sign in and complete T1 with a recognizable request. | The chosen service stays selected. Pictured fabrics illustrate categories. Each shop supplies its own service name, description and price. |
| Tailor | Open **Ringkasan**. Select **Permintaan masuk**. Find the customer name and description, open the job and send a quote. On mobile, use **Layanan Saya**, expand **Ubah layanan**, then open **Profil Usaha**. | The selected tile opens the matching queue. Each row has its source, timing, status and action. The other queues are available under **Antrean lain**. At phone width, shop destinations have visible text and remain reachable above the queue. |
| Customer and tailor | On **Pesanan Saya**, open the new quote from **Perlu tindakan Anda**, follow **Tinjau penawaran v1**, then accept. Have the tailor advance the order to **Siap diambil**. Refresh and open **Lihat pengambilan**. Have the tailor complete the handover and refresh again. | The order tracker marks the current stage. Pickup requires the customer's attention. Completed work appears in **Riwayat**. A quote past its validity is excluded from the customer's action group until reissued. |
| Both roles | Repeat T2 with the second pair of fixture accounts. | The tailor reaches the assigned conversation through **Ringkasan → Chat WhatsApp · simulasi**. Converting the draft and accepting the quote uses the same order workflow. Messaging is labeled as simulated. |

## T8 · Guest request, verification and account recovery

Use a seeded disposable stack and its local MailCatcher inbox. The default inbox is at [127.0.0.1:3101](http://127.0.0.1:3101/). Use a unique `@marajut.test` address and keep proof codes within the test session.

1. Signed out, choose a service, fill in the request and email, and select **Simpan draf dan verifikasi email**. Add an optional synthetic JPEG or PNG on the confirmation page.
2. Check the tailor's inbox before confirming. The draft and photo should be absent. Open the confirmation link or copy its code from the local inbox, choose **Periksa tautan**, review the draft and set your name and password. An existing customer uses their current password.
3. Select **Konfirmasi dan kirim permintaan**. Expect one request and its reference photo. The assigned tailor can view them. Reusing the proof or opening the new order with another account must fail.
4. In a fresh browser session, ask for **Lupa kata sandi?** and use the latest recovery message. After setting a new password, the original session must return to sign-in. The new password opens the same order history.
5. For a standalone customer account, select **Daftar sebagai pelanggan** on the sign-in page and follow the email proof. Expect an empty **Pesanan Saya** workspace.

## T9 · Staff, orders and maintenance

1. As `operator@marajut.test`, open **Pengelolaan → Undang usaha baru**. Enter a synthetic email and re-enter the operator password. As the invitee, open the local invitation and set a password. Add an active service as the new tailor. The shop must stay out of public discovery until the operator publishes it with a reason.
2. As the customer, check the newly published shop and submit a request. Send a quote as the tailor. The customer's **Tanyakan rincian penawaran** returns it for review and removes acceptance on that revision. An expired revision also becomes unavailable and the worker writes its expiry to the timeline. Send a new quote and have the customer accept it.
3. Move the accepted order to **Siap diambil**. As the tailor, record cash only after confirming receipt. As the customer, check **Catatan tunai** and the separate work status. Void the receipt with a reason and check that the timeline shows the correction.
4. As the tailor, use **Ajukan pembatalan kepada pengelola** on an active or ready order. Review as the operator. Approval must fail while a cash receipt is current. After the receipt is corrected and approval recorded, both parties see **Dibatalkan**. Use a reason appropriate for both parties to read.
5. Revoke the invited tailor as the operator. The shop disappears from public discovery and the tailor's old session and sign-in cease to grant access. The customer can still open their own request.
6. Repeat T2, with quantity and fit notes entered under **Lengkapi permintaan**. Check that the values transfer to the linked inquiry. Use **Lepas tautan pengirim** from the customer simulator and check that the previous history remains with the original customer.

## T10 · Backup and retention rehearsal

Use a disposable Compose project. Run `node scripts/sandbox.js 3122 3123` with two unused ports for a clean workday seed. The script prints a new project name and its two URLs. It creates a separate volume each run.

Set `MARAJUT_BACKUP_PASSPHRASE` to a generated secret of at least 24 characters in the current shell. Save with `node scripts/db-backup.js save <project> <new-file>` and rehearse with `node scripts/db-backup.js rehearse <project> <file>`. Compare schema, request/order counts and photo bytes. An incorrect key must fail before temporary database creation. The restore removes its temporary database and scratch dump after verification.

Run `docker-compose -p <project> exec worker node apps/marajut/maintenance.js` for a count-only preview. In the isolated automated suite, age a closed request's photo past 90 days and run apply. Expect only the eligible image to disappear, with the order and timeline retained. The main demo uses preview mode for historical data.

## T11 · Marajut discovery and workspace

Use a fresh synthetic stack with the workday seed, the local mailbox and two separate Chrome sessions. Set `APP_ORIGIN` and `MAIL_ORIGIN` to that stack before running the browser scripts. For the web path use Ayu and Rina. For the chat path use Bima and Dewi.

| Role | Reproducible action | Expected result |
| --- | --- | --- |
| Guest | Open the homepage at 320 px, 360 px and desktop width. Tab to **Lewati ke konten**. Select **Cari Penjahit**, use a category and open a shop. Then use **Cara kerja** to read the ordering steps. | The wordmark and Masuk share the top row. Links remain reachable. The steps explain where to provide details, accept the price and track the work. Public cards show the shop’s own listings. |
| Guest → customer | Use **Buka simulasi WhatsApp** in Cara kerja (the hero no longer carries a chat link). Sign in as Bima. Follow T2. | Sign-in explains the simulation and returns directly to it. Messages stay inside Marajut. The selected service and scope follow the converted request. |
| Guest → tailor | In the second session use **Untuk penjahit**, sign in as Dewi and open **Chat WhatsApp · simulasi** from Ringkasan. Claim the conversation, reply, create the request and send a quote. | The tile opens the assigned queue. Bima can see the reply, open the linked request and approve the exact quote. Dewi can resolve the conversation. |
| Customer and tailor | Complete T1 and T5 on the ordinary web route. Check **Layanan Saya**, **Profil Usaha**, **Pesanan Saya**, pickup and history. Repeat guest confirmation and recovery with T8. | Normal web entry keeps the selected service. Shop and customer see the same accepted quote and order progress. Verification and recovery messages use Marajut. |
| Web-only configuration | Run the HTTP suite for the disabled-mode case. Open the public catalog and login with the simulator return path in that configuration. | The catalog still offers quotations. It omits chat entry links, ignores the unavailable return path, and the simulator route is unavailable. |

## Automated checks

```powershell
npm.cmd run build
docker-compose run --rm --build test
$env:BROWSER_CHANNEL = 'chrome'
npm.cmd run test:browser
npm.cmd run test:inbound-browser
npm.cmd run test:pilot-browser
```

The browser scripts create synthetic records. Use a second Compose project and port when the primary demo is in use. Set `BROWSER_SCREENSHOTS` to a directory to capture the marketplace, quote editor, public order flow and provider workspace.

## Run log

For each update record the date, build or change, test IDs, test method and observed result. Include any failure with the role, URL path, steps, expected behavior and actual behavior. Keep passwords and proof codes out of reports.

| Date (WIB) | Change and checks | Result |
| --- | --- | --- |
| 18 November 2026 | Milestone 2 tailor regression in disposable local stacks. Chrome exercised T1 and T2 end to end. | Quote issued and accepted, order completed, handoff claimed, simulated reply seen by customer, draft converted and conversation resolved. |
| 18 November 2026 | T3 Chrome assertions for the service-management UI. | Created and edited a hidden service, confirmed it was absent for the other tailor and public catalog, published it, then hid it again. |
| 18 November 2026 | PostgreSQL/HTTP suite and JavaScript build check. | 11 tests passed, including cross-business access denial and stale quote rejection. Syntax check passed. |
| 19 November 2026 | Provider workspace and public profile. Chrome T1 and T2 in an isolated Docker stack. | Passed discovery and sign-in with the chosen service, clarification, quote acceptance, completion and simulated collection notice. Passed handoff, simulated reply, draft conversion, linked conversation, quote acceptance and resolution. Checked the tailor dashboard at 360 px and desktop width. |
| 19 November 2026 | Automated T1–T4 coverage and local deployment. | All 13 PostgreSQL/HTTP tests passed, including work-queue counts, scope, profile edits and service visibility. Build and optional workday seed passed. On port 3100, Chrome confirmed the new catalog, six tailor queues and profile editor. |
| 19 November 2026 | Structured service and private media slice, T1/T2/T5/T6 in separate Compose QA. | All 15 PostgreSQL/HTTP tests passed, including wrong totals, stale revisions, corrupt and oversized files, attachment limits and cross-account denial. Both Chrome walkthroughs passed. The build and production dependency audit passed. |
| 19 November 2026 | Modern visual update and original-volume deployment. | Reviewed 360 px and desktop marketplace screenshots and the quote editor. Port 3100 reached readiness on migration 004. The original volume kept five inquiries and four orders across the update. |
| 19 November 2026 | Marketplace and workday redesign in a disposable Compose project on port 3115 with workday fixtures. Ran `npm.cmd run build`, the Compose integration suite, and both Chrome walkthroughs. | Build and all 15 PostgreSQL/HTTP tests passed. Both Chrome walkthroughs passed. Verified category/search reset, sign-in continuity, mobile shop navigation and queue switching, clarification, private photo, itemized quote, customer action grouping, pickup, completion and the simulated handoff. Confirmed the guest header stays on one row at 320, 360, 768 and 1366 px and the keyboard skip link moves focus to main. |

After QA, the primary Compose project was rebuilt. On port 3100 the readiness check passed, the new catalog and visual assets loaded, and both fixture roles signed in to their respective workspaces. The primary database contained five inquiries and four orders before and after the rebuild.

Visual checkpoints from that run show the [mobile marketplace](product/evidence/studio-market-mobile.png), [tailor desktop](product/evidence/studio-workspace-desktop.png) and [customer action list](product/evidence/studio-orders-mobile.png). Walkthroughs used automated Chrome sessions with synthetic records. Physical devices, screen-reader sessions and usability sessions with working tailors have yet to be tested. The [earlier quote editor checkpoint](product/evidence/structured-quote-editor.png) documents the structured quote workflow.

### Migration 005 · 19 November 2026 WIB

| Environment | Checks run | Observed result |
| --- | --- | --- |
| Disposable Compose project on ports 3120 and 3121 | Build, PostgreSQL integration suite, and all three Chrome walkthroughs | All 19 integration tests passed. Chrome completed the regular order, simulated WhatsApp handoff, and invited-tailor and verified-guest journeys. The pilot walkthrough used the local SMTP service and confirmed standalone signup, quote questions and revision, receipt display, password reset and loss of the old session. |
| Same Chrome pilot run | axe-core WCAG A/AA rules on marketplace, signup, management and order screens | Zero violations in the checked states. The last local walkthrough observed 289 ms for the marketplace load and 40 ms for signup. Those timings are a loopback sample. |
| Disposable backup rehearsal | Encrypted save, restore, wrong-key check | Restored schema 005, nine requests, six orders and two photos containing 548 bytes. A wrong key was rejected before restore. |
| Fresh sandbox on ports 3122 and 3123 | Sandbox create, seed, readiness and retention preview | New isolated stack reached readiness. Preview returned zero eligible historical records. The integration suite separately verified that an aged image could be removed while the cancelled order and audit remained readable. |
| Rebuilt QA containers | Graceful Docker stop after switching the web and worker entrypoints to Node | Web, worker, mail and database exited with status 0. The primary deployment reached readiness with the same entrypoints. |
| Primary Compose project | In-place migration, readiness, mailbox, sign-in smoke | Migration 005 applied to the original volume. Customer, tailor and platform operator signed in. Five inquiries and four orders were present before and after. |

The pilot screenshot shows the [cash receipt in the customer workspace](product/evidence/pilot-tunai.png).

The operator notification-retry control remains unverified in Chrome. The CI workflow was added to the workspace and has not run on GitHub. Production email, official WhatsApp delivery, off-host backup scheduling, field usability and real-data retention remain unverified. Historical retention was not applied to the primary volume.

### GitHub repository push · 24 November 2026 WIB

Role affected is the repository maintainer. Use a local checkout on `main` and a GitHub credential with write access to `TheGoodEvil28/merajut`.

1. Run `git remote -v`. Expect both fetch and push URLs for `origin` to point to `https://github.com/TheGoodEvil28/merajut.git`.
2. Run `git push --dry-run origin main`. For the initial push, expect Git to report that it will create `main`.
3. Run `git push -u origin main`. Compare `git rev-parse HEAD` and `git ls-remote origin refs/heads/main`. Expect matching commit hashes and `main` to track `origin/main`.

Checked both remote URLs after updating `origin`. The remote had no `main`, and the dry run reported a new branch. Customer and tailor flows and GitHub Actions were not exercised for this repository change.

### Landing visual refresh · 25 November 2026 WIB

Roles affected are guest, customer and tailor, because the footer and the navbar border are shared by every page. Prerequisites: the dev-mode stack above, on `http://localhost:3100/`, with the demo seed. The shop banner (**Punya usaha jahit?**) shows only to guests and tailors. Use synthetic accounts only.

1. As a guest at desktop width, open `/`. Expect larger gaps between the hero, **Layanan jahit di sekitar Anda**, **Cara memesan di Marajut** and the shop banner. Expect wider card gaps, larger step icons, a taller banner and no line under the navbar. Service cover images carry a 10% black tint, and the category tag stays readable.
2. Scroll down. The navbar stays out of view until you scroll more than 0.6 of the viewport height (changed from 1.0 on 25 November). Then it slides in from above, fixed, with a soft shadow and no jump in the page content. Scroll back above 0.6 of the viewport height. It slides out and the normal header is back.
3. At the bottom, expect the logo with a one-line description on the left. On the right expect **Halaman** (Cari Penjahit, Cara memesan, Untuk penjahit) and **Kontak**. The contact address `halo@marajut.test` is a placeholder to replace with a real one.
4. Repeat at 375 px: no horizontal scroll, one-column footer, and the pinned navbar covers no content.
5. Sign in as a customer and as a tailor. The footer's third page link becomes **Pesanan Saya** or **Ruang usaha**. Open a tailor workspace page and confirm the sidebar, page spacing and footer still look right.
6. Repeat T1 for the customer and T11 for the tailor, since shared layout changed.

Checks run in the in-app browser against the running dev server: computed styles for the header border, section padding, card gap, icon size, tint and footer columns; the navbar pin, release and leave cycle with scroll events dispatched by script; and a 375 px overflow check (the guest page). Screenshots showed the pinned navbar, steps, banner and footer at desktop width.

Not verified: the pane does not run animation frames, so the slide animation and real trackpad scrolling were not seen. Signed-in footer links, tailor workspace pages, the tablet width, keyboard focus on the pinned navbar, `npm test`, axe-core, and the T1/T11 customer and tailor regressions were not run.

### Landing follow-up: hero and navbar · 25 November 2026 WIB

Roles affected are guest, customer and tailor, because the navbar height and the empty-state colour are shared. Prerequisites are the dev-mode stack and demo seed above.

1. As a guest at desktop width, open `/`. Expect a navbar about 45 px tall (60% of before). The navbar and hero together fill the first screen. The hero text and photo share one vertical centre. In the heading, **Setiap Jahitan Terhubung.** is lighter than **Dari Web ke Chat,**. The hero has no **Coba chat WhatsApp (simulasi)** link.
2. Open `/?q=zzzzqq`. Expect **Tidak ada layanan yang cocok.** in a plum-pink panel with plum text, not green. The same panel is used for empty tailor queues, so also open an empty queue as a tailor.
3. Repeat at 375 px: the hero fits the first screen below the two-row navbar with no horizontal scroll.
4. The chat simulation entry points left are **Buka simulasi WhatsApp** in Cara memesan and the **Chat simulasi** navbar link for signed-in users. Repeat T2 and T11 from those.

Checks run in the in-app browser on the dev server: computed navbar height (45 px), hero bottom edge against the viewport (800 px at desktop, 814 px against 812 px at 375 px before a 0.2 rem correction, then not re-measured), centre alignment, heading weights, absence of the chat link, empty-state colours, and horizontal overflow at 375 px.

Not verified: the 0.2 rem mobile correction after it was applied, tablet widths, the empty tailor queue colour, signed-in navbar height, short laptop screens where the hero text may exceed one screen, `npm test`, and the T2/T11 regressions.

### Navbar reveal threshold · 25 November 2026 WIB

Roles affected are guest and customer (storefront pages only). Prerequisites: the dev-mode stack above. Open `/` at desktop width and scroll. Expect the navbar to slide in from above once you pass 0.6 of the viewport height (480 px on an 800 px screen) and to slide out again when you scroll back above that line. The navbar height stays at the reduced 45 px. Checked by script only: scroll events dispatched at 400 px (still hidden) and 500 px (pinned) were not run after this change; the slide animation itself is not verified. See the landing refresh entry above for the other unverified items.

### Navbar height reverted · 25 November 2026 WIB

Roles affected are guest, customer and tailor (shared navbar). The navbar minimum height is back to 4.7 rem (3.8 rem on phones), and the hero height is again viewport height minus 4.7 rem. This supersedes the 45 px navbar expectation in the hero follow-up entry above. Open `/` at desktop width: expect the navbar about 75 px tall and the navbar plus hero to fill the first screen. The 0.6 viewport reveal threshold is unchanged. Checks run: measured navbar height and hero bottom edge against the viewport (see results in the hand-off). Not verified: 375 px, signed-in pages and the tailor workspace.

### Lenis smooth scroll on the landing page · 25 November 2026 WIB

Roles affected are guest and customer (the storefront landing page `/` only; login, workspace and request pages do not load Lenis). Prerequisites: the dev-mode stack above. This change adds the pinned dependency `lenis@1.3.28`. Run `npm.cmd ci` once on a fresh checkout. A Docker-only stack needs `docker compose up -d --build web`, because the image installs dependencies at build time.

1. Open `/` and scroll with the mouse wheel and a trackpad. Expect eased, smooth motion instead of stepped jumps. Page height and layout do not change.
2. Select **Cari Penjahit**, **Cara kerja** and **Bagaimana cara memesan?**. Expect an eased scroll that lands with the section heading visible below the pinned navbar.
3. Scroll past 0.6 of the viewport. The navbar still slides in and out as before.
4. Turn on the OS **reduce motion** setting and reload. Expect plain native scrolling.
5. Open `/login` and a workspace page. Expect normal browser scrolling, with no `lenis` class on `<html>`.
6. Use the keyboard (Tab, Space, Page Down, End) and open the browser console. Expect no errors.

Checks run in the in-app browser on the dev server: the three Lenis assets return 200 with correct types, `window.Lenis` exists, `<html>` gets the `lenis` class, the console has no errors or CSP violations, the login page does not reference Lenis, and the Lenis scroll position matches `scrollY` while the navbar pins and releases (scroll events were dispatched by script). `npm audit` reported 0 vulnerabilities on install.

Not verified: the feel of the smoothing (this pane does not run animation frames), real mouse wheel and trackpad input, anchor landing offset (`-88` px, set by estimate), touch devices, reduce-motion behaviour, keyboard scrolling, a Docker rebuild, and `npm test`.

### Typography: Bricolage Grotesque replaced by bold DM Sans · 25 November 2026 WIB

Roles affected are guest, customer, tailor and operator, because the heading font is shared by every page. Prerequisites: the dev-mode stack above. Use hard refresh (Ctrl+F5) so the browser drops the old font.

1. Open `/`. Expect every heading, the wordmark, the footer wordmark and service prices in DM Sans (bold, 700; the wordmark 800). **Setiap Jahitan Terhubung.** stays at weight 400.
2. Open `/assets/fonts/bricolage-grotesque.woff2`. Expect 404. Only `dm-sans.woff2` and its license remain in `public/fonts`.
3. Sign in as a tailor and open Ringkasan, Layanan Saya and a request. Look for queue counts, order headings and queue names that wrap or collide, because DM Sans is wider than Bricolage. Repeat as a customer on Pesanan Saya and a request page, and at 375 px.
4. Repeat T1 for the customer and tailor, since every page's typography changed.

Checks run in the in-app browser on the dev server, on the landing page only: computed font family and weight for h1, h2, h3, the wordmark, prices and the tagline; the document fonts list shows only DM Sans loaded; the old font file returns 404; a desktop screenshot of the hero. Also searched the code for leftover references and found none (the UX assessment doc was updated).

Not verified: tailor, customer and operator pages, wrapping of large queue numbers (they use weight 670), 375 px, the letter-spacing values that were tuned for Bricolage, and `npm test`.

### Cara memesan: step arrows and larger icons · 25 November 2026 WIB

Roles affected are guest and customer (storefront landing page `/` only). Prerequisites: the dev-mode stack above. Hard refresh (Ctrl+F5) first.

1. Open `/` at desktop width and scroll to **Cara memesan di Marajut**. Expect the three step icons at about 67 px (up from 45 px) and a clay-coloured arrow in each of the two gaps, level with the icons. There is no arrow after the last step.
2. At 375 px expect the steps stacked, a down arrow under steps 1 and 2 aligned with the icon, and no horizontal scroll.
3. Use a screen reader or inspect the accessibility tree. The arrows are decorative and should not be read aloud (a browser without support for the empty alternative text may announce "right arrow").
4. Check **Jelajahi layanan**, **Buka simulasi WhatsApp** and **Lihat pesanan saya**: each link still works and is not covered by an arrow.

Checks run in the in-app browser on the dev server: computed icon width (67 px), arrow content and size, no arrow after the last step, a desktop screenshot and a 375 px screenshot, and the horizontal overflow check at 375 px.

Not verified: the tablet width (720–959 px), screen-reader announcements, link click targets near the arrows, and the arrow position when the page is zoomed to 200%.

### Cara memesan: arrows switched to the icon set · 25 November 2026 WIB

Roles affected are guest and customer (storefront landing page `/` only). This replaces the text arrows from the previous entry. Prerequisites: the dev-mode stack above. Hard refresh (Ctrl+F5) first.

1. Open `/` at desktop width and scroll to **Cara memesan di Marajut**. Expect the site's own arrow icon (same style as the **Masuk** and **Buka ruang usaha** buttons) in each of the two gaps, centred horizontally in the gap and vertically on the step. There is none after the last step.
2. At 375 px expect the same icon rotated to point down, centred under steps 1 and 2, and no horizontal scroll.
3. The arrows are `aria-hidden` and should not be announced by a screen reader.
4. Select **Jelajahi layanan**, **Buka simulasi WhatsApp** and **Lihat pesanan saya**. Each link still works and is not covered by an arrow.

Checks run in the in-app browser on the dev server: two arrow elements exist, and their centres are within 1 px of the gap centre horizontally and the step centre vertically at 1280 px. At 375 px the arrow is centred on the card horizontally, and there is no horizontal overflow. Screenshots were taken at desktop width only.

Not verified: the 720–959 px width, screen-reader output, link click targets near the arrows, 200% zoom, and the vertical centring at 375 px (the measured arrow and gap centres were read, but the numbers were not compared against a screenshot).

### Catalog heading spacing · 25 November 2026 WIB

Roles affected are guest and customer (landing page `/`). Open `/` and look at **Layanan jahit di sekitar Anda** and its subtitle. Expect a larger gap (about 2.75 rem on wide screens, 1.75 rem on phones) between the subtitle and the category tabs than before (1.1 rem). Other pages that use the same caption style (for example the workspace and profile pages) keep their old spacing, because the rule applies only inside the catalog section. Checked: the computed margin and measured gap in the in-app browser on the landing page. Not verified: other pages using `.section-caption`, 375 px and tablet widths.

### Cara memesan: more room around the arrows · 25 November 2026 WIB

Roles affected are guest and customer (landing page `/`). The gap between steps is now `clamp(3.5rem, 7vw, 6rem)` (3.5 rem → 6 rem), and 4.2 rem on phones, so each arrow has clear space on both sides. Open `/` and check **Cara memesan di Marajut** at desktop width and at 375 px: arrows stay centred between the steps, text columns are narrower but do not wrap awkwardly, and there is no horizontal scroll. Checked: measured gap, arrow width and page overflow in the in-app browser at the pane's current width only. Not verified: 375 px after this change, 720–959 px, and long Indonesian text wrapping at 1024 px.

### Logout confirmation modal and dashboard footer · 27 November 2026 WIB

Roles affected are customer, tailor and operator (every signed-in page shows **Keluar**), plus the tailor and admin dashboards for the footer. Prerequisites: the dev-mode stack, demo seed, and synthetic accounts such as `tailor@marajut.test` and `customer@marajut.test` with the local `DEMO_PASSWORD`.

The modal is a shared component. `views/confirm-dialog.ejs` is mounted once in the footer, and `public/forms.js` opens it for any form that has `data-confirm` (with optional `data-confirm-title`, `-action`, `-cancel`, `-tone="danger"` and `-icon`). Without JavaScript the form submits normally.

1. Sign in as a tailor and open **Ringkasan**. There is no footer below the dashboard (the same applies to the admin area). Select **Keluar** in the sidebar. Expect the modal to pop in (scale and fade) over a blurred dark backdrop, with a door icon, **Keluar dari Marajut?**, a short message, **Batal** focused, and a clay **Ya, keluar** button. The page behind does not scroll.
2. Select **Batal**, press Esc, or click the backdrop. Expect the modal to animate out and you to stay signed in on the same page.
3. Open it again and select **Ya, keluar**. Expect to be signed out and returned to `/` with the footer visible.
4. Repeat steps 2–3 as a customer from **Pesanan Saya** (storefront header, footer still shown there) and at 375 px.
5. Turn on the OS **reduce motion** setting. The modal opens and closes with no animation.
6. With JavaScript disabled, **Keluar** signs out immediately without a modal.

Checks run in the in-app browser on the dev server: as the synthetic tailor, a real click on **Keluar** opened the modal (screenshot reviewed), **Batal** kept the session, and **Ya, keluar** signed out to `/`. On the landing page, with `data-confirm` added to the search form by script, cancel, Esc and backdrop never submitted the form, confirm submitted it exactly once, the danger tone, default texts and initial focus on **Batal** applied, and the modal reopened afterwards. The dashboard footer computed to `display: none`, and the storefront footer was visible after logout. `npm.cmd run check` passed. The only automated logout (`tests/workflow.test.js`) posts to the API directly and is unaffected.

Bug found and fixed during the check: resubmitting from inside the dialog's `close` event with the inert **Keluar** button as submitter was silently dropped by Chrome. The resubmit now runs on the next task and passes a submitter only when it has a `name`.

Not verified: the customer and operator paths, 375 px, keyboard-only use (Tab trapping, Enter), screen-reader announcement, reduce-motion, no-JS behaviour, Firefox and Safari, and `npm test` / browser smoke suites. The customer **Pesanan Saya** page still shows the footer, because it uses the storefront layout.

### Signed-in storefront header: single "Buka Dasbor" button · 27 November 2026 WIB

Roles affected are customer, tailor and operator when they open the storefront: the home page `/` and public shop pages `/penjahit/<slug>`. Signed-out visitors and every dashboard page are unchanged. Prerequisites: the dev-mode stack, demo seed and synthetic accounts.

1. Sign in as `tailor@marajut.test` and open `/` and `/penjahit/jahit-rina`. Expect the header to show only the Marajut wordmark and a **Buka Dasbor** button at the right, with no Ringkasan, Layanan Saya, Profil Usaha, Chat simulasi or **Keluar**.
2. Select **Buka Dasbor**. Expect **Ringkasan** at `/workspace` with the full sidebar and **Keluar** (logout confirmation still applies).
3. Repeat as `customer@marajut.test`. **Buka Dasbor** opens **Pesanan Saya**, and that page keeps its usual links (Cari Penjahit, Pesanan Saya, Profil saya) and **Keluar**.
4. As an admin operator, **Buka Dasbor** goes through `/workspace` to `/pengelola`.
5. Sign out and open `/`. Expect the usual guest header (Cari Penjahit, Cara kerja, Admin, **Masuk**).
6. At 375 px, signed in, the wordmark and button share one row with no horizontal scroll.

Checks run in the in-app browser on the dev server, as the synthetic tailor: screenshot of `/penjahit/jahit-rina` with the lone button; fetched `/` (button to `/workspace`, no nav), `/workspace` and `/workspace/services` (full nav and **Keluar** unchanged); `/workspace` resolves for the tailor; at 375 px on `/` the header is one 61 px row, the button sits 16 px from the edge, and there is no overflow. `npm.cmd run check` passed.

Not verified: customer and operator roles, the guest header after this change, tablet width, and the landing hero height on phones when signed in. That hero height subtracts a two-row (98 px) header, so it is about 37 px short of a full screen when the signed-in header is one row.

### Guest navbar without Admin link · 27 November 2026 WIB

The role affected is the guest (signed out). Prerequisites: the dev-mode stack. Open `/` in a signed-out session. Expect the header to show **Cari Penjahit**, **Cara kerja** and **Masuk** only, with no **Admin** link. Admins still reach `/pengelola` by signing in, or through the footer's **Ruang admin** link, which was left in place. Signed-in headers are unchanged: the storefront shows **Buka Dasbor**, and dashboards show the full nav.

Checks run: fetched `/` without cookies in the in-app browser (nav: Cari Penjahit and Cara kerja; account: Masuk; the footer admin link is still present) and with the tailor session (Buka Dasbor only). Searched `scripts/` and `tests/` for an Admin header link and found none. `npm.cmd run check` passed. Not verified: a screenshot of the guest header, 375 px, and the operator sign-in path to `/pengelola`.

### Guest footer without Ruang admin link · 27 November 2026 WIB

The role affected is the guest (signed out). Prerequisites: the dev-mode stack. Open `/` signed out and scroll to the footer. Expect **Halaman** to list **Cari Penjahit** and **Cara memesan** only. There is now no link to `/pengelola` anywhere on guest pages; admins reach it by signing in through **Masuk**. Signed-in footers are unchanged: tailors also see **Ruang usaha**, and customers see **Pesanan Saya**.

Checks run: fetched `/` without cookies in the in-app browser (footer: Cari Penjahit and Cara memesan, and no `/pengelola` link on the page) and with the tailor session (also Ruang usaha). Searched `scripts/` and `tests/` for "Ruang admin" and found no use. `npm.cmd run check` passed. Not verified: customer footer, and the operator sign-in path to `/pengelola`.

### Guest header on phones: logo and Masuk only · 27 November 2026 WIB

The role affected is the guest (signed out) on storefront and login pages at 720 px and below. Prerequisites: the dev-mode stack.

1. Signed out, open `/` at 375 px. Expect one header row with the Marajut wordmark at left and **Masuk** at right. **Cari Penjahit** and **Cara kerja** are hidden on phones; they remain in the footer and as sections on the page.
2. Expect the hero to fill the first screen below the header (the phone hero offset is now 3.9 rem, matching the one-row header used by guests and by signed-in visitors with **Buka Dasbor**).
3. At desktop width the guest header still shows **Cari Penjahit**, **Cara kerja** and **Masuk**.
4. Signed in as a customer on **Pesanan Saya** at 375 px, the two-row header with links and **Keluar** is unchanged (that layout keys off the logout form, not the **Masuk** link).

Checks run in the in-app browser after signing out the synthetic tailor session: at 375 px the nav computes to `display: none`, the header is one 61 px row with **Masuk** on the same row as the wordmark, the hero bottom is at 810 px of 812 px, there is no horizontal overflow, and the screenshot was reviewed. At the pane's desktop width the nav is visible with both links. `npm.cmd run check` passed.

Not verified: the customer header on phones (step 4), widths 721–959 px, and the login page header on phones.

### Dashboard hamburger menu on phones and tablets · 27 November 2026 WIB

Roles affected are tailor and admin operator (studio dashboards) below 960 px. The desktop sidebar is unchanged. Customer pages are unchanged and keep their tab row. Prerequisites: the dev-mode stack, demo seed and synthetic accounts such as `tailor@marajut.test`.

1. Sign in as a tailor at 375 px. Expect a one-row top bar with the wordmark and a three-line menu button. The old tab row is gone.
2. Tap the menu button. Expect a plum drawer sliding in from the right over a dimmed (45% black) page, with **Menu** and a ✕ button, **Ringkasan** (highlighted), **Layanan Saya**, **Profil Usaha**, **Chat simulasi**, then the account name and **Keluar** at the bottom. Focus moves to ✕, and the page behind does not scroll.
3. Close it with ✕, by tapping the dimmed area, and with Esc. Each slides the drawer out, and focus returns to the menu button.
4. Pick a link in the drawer: the page opens with the drawer closed. Pick **Keluar**: the logout confirmation opens over the drawer. Esc or **Batal** closes only the confirmation.
5. At 768 px the same menu button and drawer apply. Widen past 960 px while the drawer is open: it closes and the fixed sidebar returns.
6. Repeat as the admin operator on `/pengelola` (Pesanan, Mitra, Kinerja, Operasional in the drawer).
7. With reduce motion turned on, the drawer and backdrop appear without sliding.

Test script updates: `scripts/browser-smoke.js` has a `dashboardNav(page)` helper that opens the drawer when the menu button is visible. It is used for the tailor's 360 px nav clicks and the admin's Kinerja and Pesanan clicks (the latter runs at 768 px). In `scripts/inbound-browser-smoke.js` the guest opens `/#cara-kerja` directly, because header links are hidden for guests on phones since the earlier change today.

Checks run in the in-app browser on the dev server, as the synthetic tailor:
- At 1024 px the sidebar is still fixed at 216 px with 4 links, name and **Keluar**, with no menu button or backdrop.
- At 375 px a screenshot showed the top bar. Opening the drawer set `aria-expanded`, moved focus to ✕, locked page scroll and showed a 304 px drawer over the backdrop (screenshot reviewed).
- Backdrop, Esc and ✕ each closed it and returned focus.
- **Keluar** in the drawer opened the confirmation, and Esc closed only the dialog.
- No horizontal overflow at 375 px and 768 px.
- Resizing to desktop with the drawer open closed it.
- The signed-in storefront **Buka Dasbor** button is still right-aligned.
- `npm.cmd run check` passed, including the edited smoke scripts.

Not verified: the admin role, real touch input, the drawer slide itself (the pane does not run transitions; only the end states were checked), focus trapping inside the drawer (Tab can move to the page behind), screen readers, and the browser smoke suites (`npm.cmd run test:browser`, `test:inbound-browser`, `test:pilot-browser`). Those need a disposable Compose project and were not run against the primary demo.

### Back links use an arrow icon · 27 November 2026 WIB

Roles affected are guest, customer, tailor and admin operator. Every `.back` link (14 views, including Layanan Saya, Profil Usaha, request detail, messages, public shop page, partner and account pages) changed from the text character "←" to a drawn arrow icon. Prerequisites: the dev-mode stack and synthetic accounts. Hard refresh (Ctrl+F5) first.

1. As a tailor open **Layanan Saya**. Expect the back link **Ringkasan Usaha** with a thin plum line arrow pointing left, in the same style as the other icons. Hovering nudges the arrow 3 px left (no movement with reduce motion turned on).
2. Open a public shop page such as `/penjahit/jahit-rina` (back to **Cari Penjahit**), a request page as a customer, and `/pengelola/mitra/<id>` as an admin. The same icon appears on each.
3. Screen readers now announce only the link text (for example "Ringkasan Usaha"), because the icon is empty generated content. Before, the "←" character was part of the name.

Checks run in the in-app browser, as the synthetic tailor: on `/workspace/services` the `::before` has empty content, an 18 px masked icon in the link colour, and a zoomed screenshot shows the drawn arrow. There are no console or CSP errors. `/penjahit/jahit-rina` renders the back link as "Cari Penjahit". Searched `scripts/`, `tests/` and `docs/` for "←" and found none, so no test matched the old name. `npm.cmd run check` passed. Other unicode arrows (↑ ↓ → in the landing steps and the service editor toggle) are not back links and were left unchanged.

Not verified: customer, admin and account pages visually, Safari and Firefox mask rendering, and Windows High Contrast mode, where masked icons can disappear.

### Icon arrows everywhere and custom dropdowns · 27 November 2026 WIB

Roles affected are guest, customer, tailor and admin operator. Prerequisites: the dev-mode stack and synthetic accounts. Hard refresh (Ctrl+F5) first.

**Arrows.** No unicode arrows remain in `apps/marajut`.
- The landing links **Bagaimana cara memesan?** (down), **Jelajahi layanan** (up), **Buka simulasi WhatsApp** and **Lihat pesanan saya** (right) use the site arrow icon. Hovering a right arrow nudges it.
- The **Ubah layanan** toggle on **Layanan Saya** shows a down arrow that rotates up when the editor is open.

**Dropdowns.** All 8 `<select>` fields stay native selects, restyled with CSS customizable select (`appearance: base-select`):
- service picker and handover fields in **Minta penawaran**
- category and visibility in **Layanan Saya**
- handover in the quote editor
- admin reassign (with groups)
- chat simulation service

Browsers without support keep the previous plain select. Form values, `change` events and the service hint script are unchanged.

1. As a tailor open **Layanan Saya → Tambah layanan → Kategori layanan**. Expect a one-line field with a plum chevron. Click it: the chevron flips, and a rounded card with a soft shadow fades and slides in under the field. Rows are 44 px tall with a plum hover. The current choice has a pink background and a clay check at the right.
2. Pick an option with the mouse, and with the keyboard (Enter or Space to open, arrow keys, Enter to choose, Esc to close). The field shows the new value.
3. As a customer on **Minta penawaran**, change **Penjahit dan layanan**. The guidance hint under it still updates. Submit a request and confirm the chosen handover and fitting values are saved.
4. As an admin on a reassign page, open **Layanan pengganti**. Group labels show in small uppercase muted text above their options.
5. At 375 px the popup fits the screen and scrolls when long (max 60% of the viewport height).
6. In Firefox or Safari (if no `base-select` support), the old select style appears and works.

Checks run in the in-app browser (Chromium 156, `base-select` supported), as the synthetic tailor on **Layanan Saya**, without submitting the form:
- The select computes `appearance: base-select` and the popup screenshot was reviewed.
- Long values stay on one 45 px line.
- Mouse choice set `repair` and keyboard choice set `custom`, each firing one `change` event.
- The **Ubah layanan** arrow is an icon rotated 90°.
- A landing screenshot shows the icon arrows.
- `npm.cmd run check` passed. The smoke scripts use Playwright `selectOption`, which sets values directly.

Not verified: the customer request form and its hint script, the admin grouped select, the quote editor, 375 px, Firefox and Safari fallbacks, screen readers, and the browser smoke suites.

### Tailor overview: open queue panel and performance table · 27 November 2026 WIB

The role affected is the tailor (**Ringkasan** at `/workspace`). Prerequisites: the dev-mode stack, demo seed and `tailor@marajut.test`.

1. Open **Ringkasan** at desktop width. **Antrean lain** is a fixed card with a heading and no ▼ toggle. It always lists **Butuh klarifikasi**, **Menunggu persetujuan** and **Riwayat** with counts. Each link still opens its queue.
2. Below it, **Kinerja layanan saya** is a fixed card (not collapsible) with a table: **Layanan**, **Permintaan**, **Diterima**, **Selesai** and **Bagian mitra**. The caption reads "Seluruh periode · bagian mitra dari pembayaran terverifikasi". Numbers are right-aligned. It uses the same table style as the admin **Kinerja** page.
3. At 375 px **Antrean lain** is open (it no longer folds shut on phones) and sits below **Perlu tindakan**. The table scrolls sideways inside its card, and the page itself does not scroll sideways. The table region can be focused with Tab and scrolled with the arrow keys.

Code and test changes: `provider-workspace.ejs` uses `<section>` plus `<h2>` for both blocks. `forms.js` no longer collapses `[data-queue-menu]` (the admin desk filter still collapses at 680 px). `scripts/browser-smoke.js` waits for the **Antrean lain** heading and no longer clicks a summary before choosing a queue.

Checks run in the in-app browser as the synthetic tailor:
- No `<details>` remains in either block.
- The heading and 3 queue links are present, and the table headers and two seeded rows (all zero) are correct, with numbers right-aligned. The desktop screenshot was reviewed.
- At 375 px all 3 queue links are visible, there is no page overflow, and the table scrolls inside its box (495 px of content in 297 px). The screenshot was reviewed.
- `npm.cmd run check` passed.

Not verified: queue links clicked after this change, the table with real non-zero data and long service names, keyboard scrolling of the table region, and the browser smoke suite run.

### Layanan Saya: tighter service cards · 27 November 2026 WIB

The role affected is the tailor (**Layanan Saya** at `/workspace/services`). Prerequisites: the dev-mode stack and `tailor@marajut.test`. Open **Layanan Saya**. Each service card (for example **Ganti ritsleting**) has smaller padding: about 18 px top/bottom and 22 px left/right at desktop width (from about 31 px), with no extra space above the title. Select **Ubah layanan**. The editor still opens below a divider with normal spacing. The **Tambah layanan** card and every other card keep the default padding.

Checks run in the in-app browser: computed padding of the service card (18.4 px / 22.4 px) against another card (30.7 px); a desktop screenshot; one card opened by script to measure the gap from the summary to the editor form. Not verified: 375 px, and saving an edit.

### Chat simulation page: back link · 27 November 2026 WIB

Roles affected are tailor, customer and admin operator on **Percakapan WhatsApp** / **Simulasi WhatsApp** (`/workspace/intake`). Prerequisites: the dev-mode stack and synthetic accounts.

1. As a tailor open **Chat simulasi**. Above the title expect the back link **Ringkasan Usaha** with the arrow icon, the same as on **Layanan Saya**. It opens `/workspace`.
2. As a customer open **Simulasi WhatsApp**. The back link reads **Pesanan Saya** and opens `/workspace`.
3. As an admin manager the back link reads **Pesanan** and opens `/pengelola`.
4. As a chat-only operator (no manager rights) there is no back link, because this page is their home and `/workspace` sends them back here.

Checks run in the in-app browser as the synthetic tailor: the back link text, `href` (`/workspace`), icon and position above the heading; a screenshot was reviewed. `npm.cmd run check` passed. Not verified: the customer, admin and chat-only operator variants, and the inbound browser smoke suite.

### Dashboards: smaller top spacing · 27 November 2026 WIB

Roles affected are tailor and admin operator (studio dashboard pages). Prerequisites: the dev-mode stack and `tailor@marajut.test`. The first section on dashboard pages now starts `clamp(1.25rem, 2.5vw, 2rem)` from the top (about 26 px at 1024 px wide, 32 px max), down from up to 80 px. Open **Ringkasan**, **Layanan Saya**, **Profil Usaha** and **Chat simulasi**. The location line or back link sits close below the top edge. Storefront pages (home, shop pages) keep their larger section spacing.

Checks run in the in-app browser as the synthetic tailor: computed first-section top padding was 25.6 px on `/workspace`, `/workspace/services`, `/workspace/profile` and `/workspace/intake`, and the home catalog section stays at 61 px; the dashboard screenshot was reviewed. Not verified: admin pages, and phones below 960 px (the rule also applies there, under the hamburger top bar).

### Tailor overview: consistent card gaps · 27 November 2026 WIB

The role affected is the tailor (**Ringkasan** at `/workspace`). Prerequisites: the dev-mode stack and `tailor@marajut.test`. Every gap on the overview uses one value (`--card-gap` on `.provider-home`): 1.25 rem (20 px) above 720 px and 0.85 rem (14 px) on phones. This covers the gaps between the count tiles, tiles to **Perlu tindakan**, **Perlu tindakan** to **Antrean lain**, and both cards to **Kinerja layanan saya**. **Perlu tindakan** and **Antrean lain** now stretch to the same height, so their bottom edges line up.

1. Open **Ringkasan** at desktop width. All gaps look equal, and the two middle cards end at the same line.
2. At 375 px the stacked tiles and cards are all evenly spaced, with no horizontal scroll.
3. With many open requests, **Antrean lain** grows to match the taller **Perlu tindakan** card (its links stay at the top, with empty space below).

Checks run in the in-app browser as the synthetic tailor: measured every gap as 20 px at 1024 px and 14 px at 375 px; the two middle cards had equal height; there was no overflow at 375 px; the desktop screenshot was reviewed. Not verified: a busy queue (step 3), 721–959 px, and the admin desk.

### Layanan Saya and Profil Usaha: no business name above the title · 27 November 2026 WIB

The role affected is the tailor. Prerequisites: the dev-mode stack and `tailor@marajut.test`. On **Layanan Saya** the line "Jahit Rina · Semarang Tengah" is removed, and on **Profil Usaha** the line "Jahit Rina" is removed. Each page now shows the back link, then the title and **Lihat profil publik**. The business name still appears on the **Ringkasan** heading, in the sidebar account name, and in the **Nama usaha** field on **Profil Usaha**.

Checks run in the in-app browser as the synthetic tailor: both pages render with no `.location` line in the main content, the order is back link then heading, and the title sits at the same position on both. Searched the smoke scripts: they look for "Jahit Rina" only on the overview heading and the public shop page, which are unchanged. `npm.cmd run check` passed. Not verified: 375 px.

### Profil Usaha back link label · 27 November 2026 WIB

The role affected is the tailor. The back link on **Profil Usaha** now reads **Ringkasan Usaha** (it was **Ringkasan**), matching **Layanan Saya** and **Chat simulasi**. It still opens `/workspace`. Checked: rendered back link text and `href` on `/workspace/profile` and `/workspace/services` in the in-app browser. The smoke script's **Ringkasan** lookups are scoped to the dashboard navigation, so they are unaffected.

### Chat simulation: refresh icon on Muat ulang · 27 November 2026 WIB

Roles affected are tailor, customer and admin operator on `/workspace/intake`. The **Muat ulang** button at the top right now shows a refresh icon (new `refresh` symbol in `public/studio-icons.svg`, same line style as the other icons) before its label. The icon turns half a circle on hover; with reduce motion turned on it does not move. It still reloads `/workspace/intake`, and the accessible name is still "Muat ulang". Checked in the in-app browser as the synthetic tailor: the button text, link and icon reference, the sprite served with the new symbol, and a zoomed screenshot. Not verified: the inline **Muat ulang** link on a conversation page and **Muat ulang notifikasi** on the customer messages page, which were left as text links.

### Admin: consistent Tambah mitra button · 27 November 2026 WIB

The role affected is the admin operator. Prerequisites: the dev-mode stack and `operator@marajut.test`. On **Pengelolaan platform** (`/pengelola`) and **Mitra penjahit** (`/pengelola/mitra`) the **Tambah mitra** button is now the same primary plum button with a leading plus icon (new `plus` symbol in `public/studio-icons.svg`). Before, it was a secondary button with a shop icon on the first page and a primary button with a trailing arrow on the second. Both open `/pengelola/mitra/baru`.

Checks run in the in-app browser after signing in as the synthetic operator: on both pages the button has class `button`, a plum background, white text, the plus icon before the label, and the same size and position (zoomed screenshots compared). No smoke script clicks this button by name. `npm.cmd run check` passed. Not verified: 375 px and the tailor-side pages (unchanged). The in-app browser session is now signed in as the operator.

### Table cards: tighter padding · 27 November 2026 WIB

Roles affected are the admin operator (**Kinerja** at `/pengelola/kinerja`) and the tailor (**Kinerja layanan saya** on **Ringkasan**). Any card that directly holds a `.desk-table` now uses smaller padding: `clamp(.85rem, 1.6vw, 1.15rem)` vertical and `clamp(.9rem, 1.8vw, 1.25rem)` horizontal. The table loses its 1 rem top margin when it is the first thing in the card, and keeps 0.75 rem when a heading sits above it.

1. As the admin open **Kinerja**. The caption and table start about 17 px below the card edge (from 48 px), and the card ends about 17 px below the last row (from 32 px).
2. As a tailor open **Ringkasan**. The **Kinerja layanan saya** card is tighter, with about 12 px between the heading and the table.

Checks run in the in-app browser as the synthetic operator: the admin card padding computed to 16.4 / 18.4 px, with 17 px from the card top to the caption and 17 px from the table to the card bottom; a screenshot was reviewed. Not verified: the tailor card (the session was the operator), and 375 px.

### Admin: Buka Dasbor outside the admin area · 27 November 2026 WIB

The role affected is the admin operator (manager). Prerequisites: the dev-mode stack and `operator@marajut.test`. On any page outside the admin dashboard (for example **Percakapan WhatsApp** at `/workspace/intake`, the home page and public shop pages), the header shows only the wordmark and **Buka Dasbor**, which opens `/pengelola` directly. Before, the full admin links (Pesanan, Mitra, Kinerja, Operasional, Keluar) appeared on those pages in the storefront layout. Admin dashboard pages (`/pengelola…` and request pages) keep the sidebar and **Keluar**. Tailors, customers and chat-only operators are unchanged.

Checks run in the in-app browser as the synthetic operator: fetched `/workspace/intake` and `/` (no nav, a single **Buka Dasbor** linking to `/pengelola`) and `/pengelola` and `/pengelola/mitra` (sidebar with 4 links and **Keluar**); a screenshot of the chat page was reviewed. The smoke scripts use admin navigation only on `/pengelola` and request pages, which are unchanged. `npm.cmd run check` passed. Not verified: request pages as the admin, 375 px, and the chat-only operator.

### Footer: even row spacing · 27 November 2026 WIB

Roles affected are guest, customer and admin (storefront pages show the footer; dashboards hide it). Every footer row (**Halaman** links and **Kontak** lines) is now a 44 px row with the text vertically centred. Before, the links were centred in 44 px while the plain "Semarang, Jawa Tengah" line sat at the top of a 22 px line, so the two columns looked unevenly spaced. Open any storefront page and scroll to the footer: **Cari Penjahit** / **halo@marajut.test** and **Cara memesan** / **Semarang, Jawa Tengah** sit on the same lines with equal spacing. Checked in the in-app browser: all four rows are 44 px tall, with text centres at the same heights in both columns; a zoomed screenshot was reviewed. Not verified: 375 px (single-column footer) and signed-in footers with a third link.

### Footer: tighter rows · 27 November 2026 WIB

Roles affected are guest, customer and admin on storefront pages. Footer rows are now 2 rem (32 px) instead of 44 px, with no extra gap between rows, so the lines in **Halaman** and **Kontak** sit 32 px apart (from 46 px). Text stays centred and aligned across both columns. Each link still has a 32 px tall tap area, above the 24 px minimum in WCAG 2.2 (2.5.8) but below the 44 px used elsewhere in the app. Checked in the in-app browser: all four rows are 32 px tall and the text centres match across the columns (648 / 680 px); a zoomed screenshot was reviewed. Not verified: 375 px and touch use on a phone.

### Admin desk filters: one scrolling row · 27 November 2026 WIB

The role affected is the admin operator (**Papan pesanan** on `/pengelola`). Prerequisites: the dev-mode stack and `operator@marajut.test`. The filter chips (Semua, Perlu tindak lanjut, Koordinasi, Menunggu pelanggan, Pengerjaan, Pembayaran, Serah terima, Keluhan, Riwayat) no longer wrap onto a second line. They stay on one row that scrolls sideways, with a thin rounded plum scrollbar on a pale track (WebKit and Chromium). Firefox gets a thin scrollbar in the same colours. The row snaps lightly to chip edges. When the selected filter is off-screen (for example **Riwayat**), the row opens scrolled so that chip is visible. Below 680 px the chips are still inside the collapsible **Antrean** menu, and when it is opened they show as the same scrolling row.

Checks run in the in-app browser as the synthetic operator: at 1024 px all 9 chips are on one row (1195 px of chips in 702 px), with no page overflow, and a zoomed screenshot shows the scrollbar. With `?filter=history` the row opens at `scrollLeft` 493 with **Riwayat** fully visible. At 375 px the menu starts collapsed; opened, the chips are one scrolling row, the last chip is reachable, and there is no page overflow. `npm.cmd run check` passed. The smoke steps that check `aria-current` and click **Pembayaran** at 375 px rely on Playwright scrolling the chip into view. Not verified: the smoke suite run, Firefox and Safari, trackpad and touch swiping.

### Form fields: backend sync check and required-field stars · 27 November 2026 WIB

Roles affected: all (guest, customer, tailor, admin operator), on every form. Prerequisites: the dev-mode stack and synthetic accounts.

**Sync check.** Every visible field in the 48 templates was compared with the backend rules: `validation.js` plus the schemas in `app.js`, `account-routes.js`, `intake-routes.js` and `operations-routes.js`. That covered required versus optional, min/max length, and number ranges. All number ranges and length limits match.
- **One bug fixed.** On a request page, the shared note in **Klarifikasi atau tutup permintaan** was optional, but the backend rejects an empty note for every action except **Mulai tinjau**. So a customer pressing **Kirim detail** or **Batalkan permintaan** (or a tailor pressing **Minta klarifikasi** or **Tolak permintaan**) with no note got a 422 error. The note is now `required`, and **Mulai tinjau** has `formnovalidate` so it still submits without a note.
- **Fields that are stricter in the form than on the backend (left as is, safe):** the signup name on the account-proof page, **Jumlah pakaian** on the request and chat forms, and **Cara serah terima** in the quote editor.

**Stars.** Each of the 68 required fields now shows a small red `*` after its label text. On the quote editor only the first price line is marked, and on the cash-receipt checkbox the star follows the sentence. The star is drawn with CSS (`.req::before`) on an empty `aria-hidden` span, so labels, accessible names and Playwright `getByLabel(..., { exact: true })` lookups are unchanged. The label text and star are wrapped in `.field-label`, so they stay on one line inside the grid label. Optional fields keep their "(opsional)" hints where they existed.

1. Open `/login` and `/mitra/daftar` signed out. Every field shows a red star.
2. As a tailor open **Layanan Saya → Tambah layanan**. **Nama layanan**, **Deskripsi** and **Harga awal** have stars; **Kategori**, **Perkiraan durasi**, **Panduan** and **Visibilitas** do not.
3. As a customer open a request in **Butuh klarifikasi** and press **Kirim detail** with an empty note. The browser asks for the note instead of the server returning an error. As a tailor on a new request, **Mulai tinjau** works with an empty note, while **Minta klarifikasi** asks for one.
4. In the quote editor only the first line's **Rincian**, **Jumlah** and **Harga satuan** are starred. Added lines are not.

Checks run: a field inventory script over all templates against the backend schemas; a Playwright run (Edge) on `/login` confirming `getByLabel('Email'|'Kata sandi', { exact: true })` each match 1 field after the change (they matched 0 while the star was text, which is why it moved to CSS); the partner sign-up form shows 4 stars for 4 required fields; screenshots of the login and partner forms were reviewed; all 48 templates compile with EJS; `npm.cmd run check` passed. The in-app browser showed the stars on the admin **Tambah mitra** form.

Not verified: step 3 (no requests exist in the demo data), the quote editor and tailor and customer forms visually, `npm test` and the browser smoke suites (not run against the primary demo database), and screen-reader output.

### Admin partner page: publication and access changes in modals · 27 November 2026 WIB

The role affected is the admin operator (**Kelola mitra** at `/pengelola/mitra/<id>`, card **Marketplace**). Prerequisites: the dev-mode stack and `operator@marajut.test`. Use a disposable stack if you will submit.

The two collapsible forms (**Ubah publikasi** / **Publikasikan profil**, and **Akses akun penjahit**) are replaced by buttons with icons that open modal forms. The account name moved into the summary list as **Akun penjahit**.
- **Publikasikan profil** (primary, eye icon) or **Sembunyikan profil** (secondary, eye-off icon) opens **Publikasikan profil?** / **Sembunyikan profil?**. The modal holds **Alasan perubahan**, **Kata sandi pengelola**, **Batal**, and **Ya, publikasikan** (plum) / **Ya, sembunyikan** (clay).
- **Cabut akses** (red outline, lock icon) opens **Cabut akses <nama>?** with **Alasan pencabutan**, **Kata sandi pengelola**, **Batal** and **Ya, cabut akses** (clay).

The modals reuse the logout modal look (pop-in animation, blurred backdrop, centred icon and title) with left-aligned fields. They open with `command="show-modal"` (native Invoker Commands, with a script fallback for older browsers). **Batal** and Esc close them with the closing animation. A backdrop click does not close them, so typed text is kept. Focus starts in the reason field. The forms post to the same endpoint with the same fields as before.

1. Open a published partner. The card shows the summary and the two buttons; no expandable sections remain.
2. Open each modal. Press **Ya, …** with empty fields: the browser asks for the reason and password, and nothing is sent. Click the backdrop: the modal stays open. Press **Batal** or Esc: it closes.
3. On a disposable stack, submit each modal with a reason and the admin password. Expect "Perubahan tercatat." and the profile state to change (hidden, published, or access revoked).
4. On an unpublished partner with an active service, the primary button reads **Publikasikan profil**.

Test change: in `scripts/pilot-browser-smoke.js` the publish step now clicks **Publikasikan profil**, fills the fields inside the dialog **Publikasikan profil?**, and presses **Ya, publikasikan**.

Checks run in the in-app browser as the synthetic operator on **Ruang Jahit Dewi**, with nothing submitted:
- No `<details>` remains in the card; the openers have the right icons, classes and `commandfor`.
- A real click on **Cabut akses** opened a true modal with focus in the reason field and two starred fields (screenshot reviewed).
- An empty submit was blocked with no navigation, a backdrop click kept it open, and **Batal** and Esc closed it.
- The publication modal title and submit button matched the published state.
- At 375 px the modal is 319 px wide and fits the screen.
- `partner.ejs` compiles, and `npm.cmd run check` passed.

Not verified: real submissions (step 3, to avoid changing the demo data), the unpublished state (step 4), the pilot smoke suite run, and Firefox and Safari.

### Admin partner page: tighter Layanan mitra list · 27 November 2026 WIB

The role affected is the admin operator (**Layanan mitra** card on **Kelola mitra**). Prerequisites: the dev-mode stack and `operator@marajut.test`. The card now uses `.disclosure-list`. The heading sits about 10 px above the first divider (from 42 px). Each service row and **Tambah layanan** is a single row of about 49 px with the text centred between its dividers. The 30 px of dead space between rows is gone. An opened row keeps 1 rem below its form. Checked in the in-app browser on **Ruang Jahit Dewi**: measured heading gap, row heights and zero gap between rows; zoomed screenshot reviewed. Not verified: a partner with many services, opened rows, and 375 px.

### Even card headings on admin pages, smaller top padding on all inner pages · 27 November 2026 WIB

Roles affected: all. Prerequisites: the dev-mode stack and synthetic accounts.

1. **Admin cards.** As the admin, open **Kelola mitra**. **Profil mitra**, **Marketplace** and **Layanan mitra** each have their heading exactly 16 px above the first content. Before, the gaps were 27 px, 42 px and 10 px. Inside admin workflow layouts the card gap now does the spacing, with no extra margin on the heading or caption.
2. **Top padding.** The first section on every page now starts `clamp(1.25rem, 2.5vw, 2rem)` from the top (about 26 px at 1024 px, 32 px max), down from up to 80 px. This rule used to apply to dashboards only. It now also covers storefront inner pages: the public shop page (`/penjahit/<slug>`), login, customer pages and the chat simulator. The home page is unchanged, because its hero is not a `.section`.

Checks run in the in-app browser: measured first-section top padding of 25.5 px on `/penjahit/jahit-rina`, `/workspace/intake` and the partner page; the home page hero is unaffected; the three card heading gaps were 16 px each; a screenshot of the shop page was reviewed. Not verified: login, customer and request pages visually, and 375 px.

### Admin desk filters: no fold-out on phones · 27 November 2026 WIB

The role affected is the admin operator (**Papan pesanan** on `/pengelola`). Prerequisites: the dev-mode stack and `operator@marajut.test`. The filter chips are no longer wrapped in a collapsible "Antrean …" menu below 680 px. They always show as the single scrolling row, and the selected chip is scrolled into view. The `<details>` became a plain `<div data-desk-filter-menu>`. The `forms.js` code that closed it on phones and the summary styles were removed. In `scripts/browser-smoke.js` the two phone steps now wait for the **Filter pesanan** navigation and no longer open a summary before choosing a filter.

Checks run in the in-app browser as the synthetic operator at 375 px with `?filter=work`: no summary, the chip row is visible on one line, **Pengerjaan** is selected and fully in view, and there is no page overflow (screenshot reviewed). `desk-overview.ejs` compiles, and `npm.cmd run check` passed. Not verified: the browser smoke suite run, and widths 681–959 px.

### Dashboard sidebar: full-width Keluar · 27 November 2026 WIB

Roles affected are tailor and admin operator (desktop sidebar, 960 px and wider). **Keluar** at the bottom of the sidebar is now a full-width row (same width, left edge, padding and icon gap as the nav links) instead of a text-width button. Hovering highlights the whole row. It still opens the logout confirmation. The phone and tablet drawer already used a full-width **Keluar**. Checked in the in-app browser as the synthetic operator at 1024 px: the button and the nav links are both 184 px wide from the same left edge; a zoomed screenshot was reviewed. Not verified: the tailor sidebar (same rule) and the hover colour.

### Operasional: invite old business users in a modal · 27 November 2026 WIB

The role affected is the admin operator (**Operasional** at `/pengelola/operasional`). Prerequisites: the dev-mode stack and `operator@marajut.test`. Use a disposable stack if you will submit.

The collapsible **Undang pengguna ruang usaha lama** form is replaced by a card **Pengguna ruang usaha lama** with a short explanation and a primary **Undang pengguna** button (plus icon). It opens the modal **Undang penjahit lama** with the same fields and endpoint: **Nama usaha**, **Area layanan**, **Cerita usaha**, **Email penjahit**, **Kata sandi pengelola**, plus **Batal** and **Kirim undangan**. Focus starts in **Nama usaha**. **Email penjahit** now has `autocomplete="off"`: the browser had been filling it with the signed-in admin's own email, as if it were the username for the password field below. **Batal** and Esc close the modal; a backdrop click does not.

1. Open **Operasional**. The card shows **Undang pengguna** on one line. Open the modal and press **Kirim undangan** with empty fields: the browser asks for each required field and nothing is sent.
2. With saved browser passwords, open the modal again. **Email penjahit** should stay empty (browsers may still offer suggestions on click).
3. On a disposable stack, fill and submit. Expect the same result as before (draft profile plus invite email).

Test change: `scripts/pilot-browser-smoke.js` now clicks the **Undang pengguna** button to open the modal. The rest of the step (locating the form by its **Kirim undangan** button and filling the fields) is unchanged.

Checks run in the in-app browser as the synthetic operator, with nothing submitted:
- The opener opened a true modal with focus in the name field and all 5 fields required; an empty submit was invalid (screenshot reviewed).
- **Batal** and Esc closed the modal, and a backdrop click kept it open.
- The opener is 44 px (one line) in the 290 px card, and it is the only button with that name.
- The template compiles, and `npm.cmd run check` passed.

Not verified: a real invite, whether Edge or Chrome honours `autocomplete="off"` here (step 2), the pilot smoke run, and 375 px.

### Tailor pages: no back link · 27 November 2026 WIB

The role affected is the tailor. Prerequisites: the dev-mode stack and `tailor@marajut.test`. **Layanan Saya**, **Profil Usaha** and **Chat simulasi** no longer show the **Ringkasan Usaha** back link (the sidebar or drawer already links to **Ringkasan**). Each page now starts with its title row at the top. On the chat page, customers keep **Pesanan Saya** and admin managers keep **Pesanan**, because they do not have the tailor sidebar.

Checks run in the in-app browser: as the synthetic operator, `/workspace/intake` still has the back link **Pesanan** to `/pengelola`. After signing in as the synthetic tailor, `/workspace/services`, `/workspace/profile` and `/workspace/intake` have no back link, their first element is the title row, and the title is 26 px from the top. A screenshot of **Layanan Saya** was reviewed. `npm.cmd run check` passed. No smoke script uses these back links. Not verified: the customer chat page and phone widths.

### Modals: custom scrollbar and focus glow · 27 November 2026 WIB

Roles affected: all (every modal: logout confirmation, the admin publish, revoke and invite forms). Prerequisites: the dev-mode stack. When a modal is taller than the window (short screens, or browser zoom of 110% and above), it now scrolls with a 6 px rounded plum scrollbar on a transparent track, inset 1 rem from the top and bottom so it stays inside the rounded corners. It darkens on hover. Firefox gets a thin scrollbar in the same colour. Because Chrome and Edge make scrollable boxes keyboard-focusable, a focused modal now shows the site focus glow (a soft clay ring) instead of the browser default dark outline.

1. As the admin open **Operasional → Undang pengguna** at 110% zoom or in a short window. Expect the thin plum scrollbar and no dark ring around the modal.
2. Scroll inside the modal with the mouse and keyboard. All fields and **Batal** / **Kirim undangan** are reachable.

Checks run in the in-app browser as the synthetic tailor at 900x420 px, with filler added to the logout modal in the page (not in code): the modal scrolls, the scrollbar is 6 px with the plum thumb, inset from the corners (screenshot reviewed). Not verified: the focus glow itself (focus could not be placed on the modal in the pane), Firefox, and the admin invite modal at 110% zoom.

Known issue, not fixed: in the user's Edge, **Email penjahit** in the invite modal is still autofilled with the signed-in admin email even with `autocomplete="off"`.

### Tailor page titles: same size as admin · 27 November 2026 WIB

The role affected is the tailor (and admin dashboard pages, which already used this size). Every dashboard title (`.studio-shell main h1`) now uses `clamp(2rem, 4vw, 3.25rem)`, the admin page-heading size, instead of the global `clamp(2.5rem, 5vw, 4rem)`. This covers the business name on **Ringkasan**, **Layanan Saya**, **Profil Usaha** and **Percakapan WhatsApp**. Storefront and home titles are unchanged. Checked in the in-app browser as the synthetic tailor at 1024 px: all four titles compute to about 40.8 px (the admin rule at that width), and the home hero stays at about 54.6 px; a screenshot of **Profil Usaha** was reviewed. Not verified: phone widths.

### Profil Usaha: info card above the form · 27 November 2026 WIB

The role affected is the tailor (**Profil Usaha** at `/workspace/profile`). Prerequisites: the dev-mode stack and `tailor@marajut.test`. The page is now one column (max 52 rem wide). The **Tampilan untuk pelanggan** card comes first as a compact info card (smaller heading, muted text), and the profile form is below it with the same width and a 16 px gap. The "not yet published" notice still appears inside the info card for unpublished profiles. Saving the form is unchanged. Checked in the in-app browser as the synthetic tailor at 1024 px: the info card sits above the form, both 742 px wide with a 16 px gap; a screenshot was reviewed; the template compiles; `npm.cmd run check` passed. Not verified: saving the profile after the change, the unpublished notice, and 375 px.

### Minta penawaran: no "Pilih layanan" estimate box · 27 November 2026 WIB

Roles affected are guest and customer (**Minta penawaran** at `/requests/new`). Prerequisites: the dev-mode stack. The highlighted estimate box (in the **Perkiraan awal** card on desktop and inside the form on phones) is now hidden until a service is chosen, so the large "Pilih layanan" placeholder no longer appears. The server renders it hidden when no service is preselected, and `forms.js` shows it as soon as a service is picked and hides it again if the choice is cleared. The "Pilih layanan" option inside the dropdown stays (the required check needs it). Opening the page from a service card (preselected service) shows the estimate straight away.

Checks run with Playwright (Edge, signed out) on `/requests/new`: the box is hidden and no visible box says "Pilih layanan"; picking the first service showed **Rp 35.000**; quantity 3 showed **Rp 105.000**; clearing the service hid the box; the screenshot was reviewed. The template compiles, and `npm.cmd run check` passed. No test refers to the placeholder text. Not verified: the phone layout (the in-form estimate) and a signed-in customer.

### Customer request page: open history, cancel modal, new card order · 27 November 2026 WIB

The role affected is the customer (`/requests/<id>`, managed request view). Admin and tailor views are unchanged. Prerequisites: the dev-mode stack and a synthetic customer with an open request (for example `customer2@marajut.test`). Use a disposable stack if you will submit.

1. Open the request. The left column shows the next-step card, **Foto referensi** and **Riwayat aktivitas**, which is now an always-open card with a heading. The right column shows **Ringkasan permintaan**, **Detail permintaan** and **Tidak jadi menjahit?**.
2. **Tidak jadi menjahit?** has a short explanation and a red-outline **Batalkan permintaan** button with a cancel icon (new `cancel` symbol). It opens the modal **Batalkan permintaan?** with **Alasan pembatalan**, **Batal** and **Ya, batalkan**. It posts the same `cancel` action as before.
3. Press **Ya, batalkan** with an empty reason: the browser asks for it and nothing is sent. **Batal** and Esc close the modal.
4. On a disposable stack, submit a reason. The request should show as cancelled, as before.
5. As the admin, the same request still has **Tindakan lain** (left) and the collapsible **Riwayat aktivitas** (right).

Checks run with Playwright (Edge, headless sessions, nothing submitted):
- As `customer2@marajut.test`: history, photos and the cancel card are in the expected columns, and no "Riwayat aktivitas" summary remains. The modal opened with focus in the reason field, the empty submit was blocked, and **Batal** closed it. Layout and modal screenshots were reviewed.
- As `operator@marajut.test`: the admin layout is unchanged. The photo section is absent for the admin because the partial only shows it when photos exist or the customer can add them.
- The template compiles, and `npm.cmd run check` passed. A backup of the previous template is in the session scratch folder.

Not verified: a real cancellation (step 4), 375 px (single column order), and a request that already has photos or several history items.

### Request page: Detail permintaan inside the summary card · 27 November 2026 WIB

Roles affected are customer and admin (the managed request view; both share the summary card). The separate **Detail permintaan** card is removed. Its text (description and **Catatan ukuran**) now sits inside **Ringkasan permintaan** / **Detail pesanan**, under the price box and the "Harga akhir…" note, above the Penjahit / Jumlah pakaian list, separated by a thin divider with a small muted heading. It keeps `id="detail"`, so **Lihat detail permintaan** still scrolls to it.

Checks run with Playwright (Edge, headless, as `customer2@marajut.test`): the detail is inside the summary card, after the price and before the list, and no separate detail card remains; **Lihat detail permintaan** sets `#detail` and the block is visible; a screenshot of the card was reviewed; the template compiles; `npm.cmd run check` passed. Not verified: the admin view, an order (with **Detail pesanan** and the quote breakdown), long descriptions with fit notes, and 375 px.

### Public shop page: banner redesign · 27 November 2026 WIB

Roles affected: guest, customer and anyone viewing `/penjahit/<slug>`. Prerequisites: the dev-mode stack.

The shop banner now follows the mockup:
- a plum-to-magenta gradient
- the pin icon and area as a small line
- the shop name as the title, then the description (and specialty if set)
- a pink pill **N Pesanan Selesai** at the top right, replacing the old line "N pesanan selesai di Marajut"
- the shop icon as a large faint outline cropped at the bottom-right corner (decorative, hidden from screen readers), replacing the apricot icon tile

Below 520 px the banner is one column and the pill moves above the location.

Checks run with Playwright (Edge) on `/penjahit/jahit-rina`: at 1280 px the pill is at the top right and the watermark is cropped by the banner edge; at 375 px the layout stacks with the pill first and no horizontal overflow; screenshots at both widths were reviewed. The template compiles, and `npm.cmd run check` passed. No test refers to the old text. Not verified: a shop with a specialty line, long names and descriptions, and contrast measurement of the pill and the light text on the gradient.

Test change: `tests/workflow.test.js` line 874 now matches "1 pesanan selesai" case-insensitively, because the banner pill reads "1 Pesanan Selesai". Not run (the suite needs a disposable database).

### Catalog search: focus state on the whole bar · 27 November 2026 WIB

Roles affected: guest, customer, and anyone on the home page. Prerequisites: the dev-mode stack. The catalog search bar (`.market-search`) no longer draws the global focus ring (3 px clay, offset) around the inner text field inside the pill. When the field is focused, the whole bar shows the focus state instead: plum border, white background, a soft 4 px plum glow with a light shadow, and a plum search icon. The bar darkens slightly on hover, the placeholder is a touch lighter, and transitions are off with reduce motion. The **Cari** button keeps its own keyboard focus ring.

Checks run with Playwright (Edge) on `/`: clicking the field gives the input no outline, while the bar gets the plum border, glow and plum icon; Tab moves to **Cari**, which shows its solid focus outline; a focused screenshot was reviewed. `npm.cmd run check` passed. Not verified: keyboard focus arriving from the header links, phones, and the admin order search (it keeps the default field style).

### Home hero on phones: photo first and taller · 27 November 2026 WIB

Roles affected: guest, customer, and anyone on the home page below 720 px. Prerequisites: the dev-mode stack. The hero photo now appears above the location line, heading and search (CSS `order: -1`; the source order is unchanged, so screen readers still read the heading first). It is taller, `clamp(11rem, 50vw, 18rem)` (about 188 px at 375 px, from about 128 px). The hero still fills the first screen, and desktop is unchanged. Checked with Playwright (Edge): at 375 px the photo is above the copy, 188 px tall, the hero ends within the 812 px screen, and there is no horizontal overflow (screenshot reviewed); at 1280 px the two-column hero is unchanged. Not verified: 320 px and tablet widths.

### Storefront header: "Cek Pesanan" for customers · 27 November 2026 WIB

The role affected is the customer. Prerequisites: the dev-mode stack and synthetic accounts. On the home page and public shop pages, the single header button for a signed-in customer now reads **Cek Pesanan** (it still opens `/workspace`, the order list). Tailors and admins keep **Buka Dasbor**. Checked with Playwright (Edge), signed in on `/` in separate sessions: `customer2@marajut.test` saw **Cek Pesanan** linking to `/workspace`, `tailor@marajut.test` saw **Buka Dasbor** linking to `/workspace`, and `operator@marajut.test` saw **Buka Dasbor** linking to `/pengelola`. The header template compiles, and `npm.cmd run check` passed. No test refers to the label. Not verified: phone width.

### Pesanan Saya: no redundant group link, group descriptions · 27 November 2026 WIB

The role affected is the customer (**Pesanan Saya** at `/workspace`). Prerequisites: the dev-mode stack and a synthetic customer with orders. Orders are grouped as **Perlu tindakan Anda** (quote to approve, details requested, ready to pick up), **Sedang diproses** (new, under review, in progress) and **Riwayat** (completed, cancelled, declined). Empty groups are hidden.

1. With orders in only one group, the shortcut bar of group links above the cards is no longer shown, because it only repeated the single heading.
2. With orders in two or more groups, the shortcut bar still appears and jumps to each group.
3. Each group heading now has a one-line muted description of which states it holds.

Checks run with Playwright (Edge) as `customer2@marajut.test` (one request in **Sedang diproses**): no shortcut bar, and the group shows its description (screenshot reviewed). The template compiles, and `npm.cmd run check` passed. The smoke tests find groups by heading, which is unchanged. Not verified: step 2 (no synthetic customer currently has orders in two groups) and phones.
