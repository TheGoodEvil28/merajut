# Marajut

**Dari Web ke Chat, Setiap Jahitan Terhubung.** Customers find local tailoring services, agree on quotations and follow their orders on the web. Tailors manage their catalog, conversations and work queues in the same application. WhatsApp conversations in the local release run inside a labeled simulator. The new experience uses the existing Djahit Express application, PostgreSQL database and notification worker. [Marajut transition assessment](docs/product/MARAJUT-PHASE-1.md)

## Start locally

1. Install Docker Engine and Compose v2. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and `DEMO_PASSWORD` to different generated secrets. Use a demo password of 12–128 characters and a Compose-safe DB password, such as a random hex string. Keep `.env` local.
3. From this directory run:

```sh
docker compose up -d --wait --build
docker compose run --rm seed
docker compose ps
```

On older Docker Desktop setups that expose Compose as `docker-compose`, use that command in place of `docker compose`. Open [127.0.0.1:3100](http://127.0.0.1:3100/) or [localhost:3100](http://localhost:3100/). The port is bound to loopback. If your browser reports a refused connection, include the port and check `docker compose ps`. Start the stack with the command above if it stopped. Restarting preserves the named data volume.

The seed creates two published businesses, three services and five synthetic accounts. They use your local `DEMO_PASSWORD`.

| Role | Account | Scope |
| --- | --- | --- |
| Customer | `customer@djahit.test` | Ayu's own requests and messages |
| Customer | `customer2@djahit.test` | Separate customer for access checks |
| Tailor | `tailor@djahit.test` | Jahit Rina |
| Tailor | `tailor2@djahit.test` | Ruang Jahit Dewi |
| Platform operator | `operator@djahit.test` | Unassigned handoff queue |

Use two browser profiles. Start at **Cari Penjahit**, open a public profile and request a quote. As the matching tailor, open **Ringkasan** to triage requests, check open quotes and see work ordered by date. **Profil Usaha** updates public business details. **Layanan Saya** controls the offering and starting price shown to customers. Follow the [test run guidebook](docs/TEST-RUN-GUIDEBOOK.md) to walk both roles through the localized order and simulated WhatsApp flows.

Use catalog search and categories to find a service. Tailors can set category, estimated duration and intake guidance. Customers can specify quantity and fit notes, then add up to three private reference photos once the request is created. Tailors quote by line item, and the server calculates the total accepted by the customer. Photos are normalized to JPEG and stored in PostgreSQL. Real-data retention and backup approval remain pilot requirements.

For a disposable demo database, add optional synthetic rows for the two tailor accounts with `docker-compose run --rm seed npm run db:seed -- --workday`. The workday examples use the ordinary workflows and preserve existing rows.

## Demo inbound intake and handoff

1. Sign in as `customer2@djahit.test` and open **Pesanan Saya → Simulasi WhatsApp**. Send a message, choose **Ruang Jahit Dewi · Perbaikan jahitan lepas** (**Seam repair** on older seeds), and submit **Detail jahitan**.
2. If the sender is unlinked, choose **Tautkan pengirim**, send the proof and refresh. Select **Konfirmasi tautan** in the session that generated the code.
3. Choose **Minta bantuan penjahit**. As `tailor2@djahit.test`, open **Ringkasan → Percakapan WhatsApp**. Choose the conversation and select **Tangani percakapan**.
4. Send **Kirim balasan simulasi** and refresh the customer conversation to see it. Choose **Buat permintaan layanan** or link a matching existing request. The operator can handle unassigned conversations.
5. Use the linked request to send a quote. The customer accepts the displayed version in their signed-in workspace. Resolve the conversation or return it to automated intake from the tailor view.

The local adapter accepts normalized text, service selection, details, handoff and binding-proof events. The browser uses an authenticated fixture sender assigned to the demo customer. Programmatic fixtures can optionally set a separate `SIMULATION_WEBHOOK_SECRET` of at least 32 characters. In a local or test environment, post exact JSON bytes to `/simulated/webhooks/whatsapp` with `X-Simulation-Signature` containing a hexadecimal HMAC-SHA256 of those bytes. For example, the envelope can be `{"eventId":"fixture-1","sender":"fixture:customer","kind":"text","text":"I need help with a hem."}`. A matching retry returns the original receipt. Reuse of an event ID with changed data returns a conflict. This endpoint is registered only when the environment, mode and secret permit fixture traffic.

Binding requires both a short-lived proof echoed by the targeted sender and confirmation in the original authenticated browser session. Proof codes are shown once and stored only as digests. A binding can prepare a draft but does not create a login session or authorize any quote decision from chat.

After selecting a business, the conversation stays scoped to that business even if staff return it to automation. To choose another business, close the current intake or ask the handler to resolve it, then start a new message.

## Database and services

`compose.yaml` runs PostgreSQL 17, a one-shot migration command, the web app and the worker. The migrator runs before the web app and worker. Migration 001 creates users, sessions, businesses, memberships, services, inquiries, quotes, decisions, orders and events. Migration 002 creates simulation preferences, the outbox, deduplicated simulation receipts and worker heartbeats. Migration 003 adds the scoped operator role, synthetic senders, session-bound challenges, conversations, a retryable inbound inbox and simulated conversation history. The migration upgrades the existing volume in place.

```sh
docker compose run --rm migrate
docker compose run --rm seed
docker compose logs web worker
docker compose exec db psql -U djahit -d djahit -c "SELECT mode, seen_at FROM worker_heartbeats;"
docker compose stop
```

The migrator stores checksums and applies pending files under a PostgreSQL advisory lock. Seed reruns refresh the fixture passwords and preserve service edits and business history. To rehearse from an empty database, use a fresh Compose project name and a different `APP_PORT`. For a PostgreSQL instance you provision separately, set standard `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` variables. Run `npm ci`, `npm run db:migrate`, and `npm run db:seed` with `DJAHIT_ENV=local` and `DEMO_PASSWORD`. Start `npm start` and `npm run worker` in separate terminals. Align `PORT` and `APP_ORIGIN` with the browser URL when overriding defaults.

Health endpoints are `/health/live` and `/health/ready`. Readiness depends on the database and schema version. Browser forms and JSON clients share the same handlers. JSON clients first fetch `GET /api/v1/session`, retain the cookie and send the returned value as `X-CSRF-Token` on writes. Refresh the session endpoint after sign-in or logout, which rotates that token.

## Local pilot workflows

Customers can enter as guests from **Minta penawaran**, verify an email, optionally stage one private photo and send the verified request to the tailor. **Masuk** also provides standalone signup and password recovery. During local testing, get messages from the loopback MailCatcher inbox at [127.0.0.1:3101](http://127.0.0.1:3101/). Use a separate `MAIL_PORT` for each Compose project. The worker uses the fixture mailbox in local and test environments. A hosted environment requires its own approved SMTP service and HTTPS origin.

The seeded platform operator has a **Pengelolaan** workspace for invitations, publication and access revocation, exceptional cancellation and simulation delivery review. Existing local seeds can receive this demo capability with `docker-compose run --rm seed npm run db:seed -- --operator-access`. A tailor can record cash received at pickup independently of work completion. Staff decisions and cash corrections have an audit trail.

Migration `005_pilot_workflows.sql` adds verification challenges, scoped staff permissions, order reviews, cash records, and structured simulated intake. The worker persists quote expiry and removes expired credentials and unclaimed verification drafts. Use the following commands in a disposable stack for maintenance rehearsal. The backup passphrase belongs in a separate secret store.

```sh
node scripts/sandbox.js 3122 3123
node scripts/db-backup.js save <project> <new-backup-file>
node scripts/db-backup.js rehearse <project> <backup-file>
docker compose -p <project> exec worker node apps/djahit/maintenance.js
```

An approved deployment can schedule encrypted backup creation and retain copies off-host. The maintenance command previews the draft 90-day closed-photo and 30-day abandoned-thread policies. Apply requires an approved policy and the explicit `--apply` switch with `DJAHIT_RETENTION_POLICY=approved-90-30`. Rehearse on synthetic data first.

## Tests

Use the [test run guidebook](docs/TEST-RUN-GUIDEBOOK.md) for role-by-role steps, expected results, and the latest verification record. Update it with each change.

Migration `004_structured_work.sql` adds service metadata, optional structured inquiry fields and quote breakdowns, and the private attachment table. Existing aggregate quotes and orders remain readable. The standard Docker startup applies the migration on the existing volume.

```sh
npm ci
npm run build
docker compose run --rm --build test
npx playwright install chromium
npm run test:browser
npm run test:inbound-browser
npm run test:pilot-browser
```

The JavaScript build check runs syntax validation. There is no frontend bundler or separate type checker in this slice. The HTTP integration suite uses a random PostgreSQL test schema in the local Compose database and drops only the schema it created. It checks role and tenancy boundaries, request replays, quote races and expiry, order progress/history, and duplicated, failed or retried notifications. The Playwright smoke runs against the seeded local web service and worker and creates a synthetic rehearsal order. Set `BROWSER_CHANNEL=chrome` to use installed Chrome or leave it unset for Playwright Chromium. Set `BROWSER_SCREENSHOTS` to a local output directory to capture the two completed-order views. Windows PowerShell installations that block `npm.ps1` can use `npm.cmd`.

## Messaging and release scope

`MESSAGING_MODE=simulated` queues quote and collection notices. The worker uses leased jobs, bounded retry and a durable per-intent simulation receipt. It checks the customer's simulation preference before recording a message. `MESSAGING_MODE=disabled` stops new intents. The adapter boundary allows a future vendor transport to declare replay behavior. Live mode is rejected and no Meta or BSP requests are sent.

Local pilots support pre-verified fixtures, verified guest accounts, password recovery, private photo uploads and operator-managed tailor invitations and publication. Live WhatsApp requires an approved Business account and number, external HTTPS callback configuration, verified sender binding with real contacts, consent and template approval, receipt reconciliation and real delivery tests. Competition publication and submission remain on hold.

## Local Git baseline

If this directory still has no Git history, first confirm the intended repository and check whether the team already has a canonical remote. For a new private history, initialize locally with `git init -b main`. Verify `.env`, dependency folders, and all local exports are ignored. Review intended files with `git add --dry-run .` and inspect `git diff --cached --stat` after staging an explicit file list. Commit the reconstruction with `LEGACY_ORIGIN.md` included. Keep the legacy ZIP in its existing archive and preserve any separately recovered Git history outside this baseline. No push is required.

## Changed files

| Area | Files |
| --- | --- |
| Local build and setup | `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `.dockerignore`, `compose.yaml`, `infra/Dockerfile` |
| Database and identities | `db/migrations/{001_core,002_messaging}.sql`, `apps/djahit/{db,migrate,seed,identity}.js` |
| Business and messaging | `apps/djahit/{catalog,inquiries,quotes,orders,outbox,worker}.js` |
| HTTP and UI | `apps/djahit/{app,server,errors,validation}.js`, `apps/djahit/views/*.ejs`, `apps/djahit/public/style.css` |
| Verification | `scripts/{check,browser-smoke}.js`, `tests/workflow.test.js` |
| Delivery docs | `README.md`, `LEGACY_ORIGIN.md`, `docs/roadmap/DJAHIT-IMPLEMENTATION-ROADMAP.md` |

Milestone 2 changed `.env.example`, `compose.yaml`, `package.json`, `apps/djahit/{app,inquiries,migrate,seed,worker}.js`, `apps/djahit/views/header.ejs`, `tests/workflow.test.js`, this README and the roadmap. It added `db/migrations/003_inbound.sql`, `apps/djahit/{inbound,inbound-adapter,intake-routes}.js`, `apps/djahit/views/{intake,intake-bind,intake-list,intake-thread}.ejs`, and `scripts/inbound-browser-smoke.js`.

See [RFC-0001](docs/rfc/RFC-0001-DJAHIT-RECONSTRUCTION.md), the [ADR register](docs/adr/README.md) and the [roadmap](docs/roadmap/DJAHIT-IMPLEMENTATION-ROADMAP.md) for remaining release work.
