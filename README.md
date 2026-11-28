# Marajut

Marajut helps residents of Semarang find and book local tailoring services. Customers review prices, arrange fittings, and track work through payment and handover. Admins manage the marketplace and coordinate with tailors over WhatsApp. Express serves the website, PostgreSQL stores orders and their history, and a separate worker handles email and simulated notifications.

Marajut is aligned with the SEVENT X Website subtheme **Decent Work and Economic Growth (SDG 8)** through service discovery for independent tailors and a documented path from quote to paid work. See the review of the attached rulebook and the prior-work eligibility question. [Competition requirements](docs/adr/ADR-0009-competition-eligibility.md) · [Project provenance](LEGACY_ORIGIN.md)

## Start locally

1. Install Docker Engine and Compose v2. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and `DEMO_PASSWORD` to different generated secrets. Use a demo password of 12–128 characters and a Compose-safe DB password, such as a random hex string. Keep `.env` local.
3. From this directory run:

```sh
docker compose build web
docker compose up -d --wait --no-build
docker compose run --rm seed
docker compose ps
```

On older Docker Desktop setups that expose Compose as `docker-compose`, use that command in place of `docker compose`. Open [127.0.0.1:3100](http://127.0.0.1:3100/) or [localhost:3100](http://localhost:3100/). The port is bound to loopback. If your browser reports a refused connection, include the port and check `docker compose ps`. The default Compose project, image and database use the Marajut name. To upgrade an existing database, retain its connection settings or set its current PostgreSQL user and database in `POSTGRES_USER` and `POSTGRES_DB` and use its existing Compose project name. Migration 008 updates the five demo account addresses in place where the new address is available. Sign in again with the updated demo address after a cookie-name change.

The seed creates two published businesses, three services and five synthetic accounts. They use your local `DEMO_PASSWORD`.

| Role | Account | Scope |
| --- | --- | --- |
| Customer | `customer@marajut.test` | Ayu's own requests and messages |
| Customer | `customer2@marajut.test` | Separate customer for access checks |
| Tailor | `tailor@marajut.test` | Jahit Rina |
| Tailor | `tailor2@marajut.test` | Ruang Jahit Dewi |
| Platform operator | `operator@marajut.test` | Admin desk, partner directory, order dispatch, payments and performance |

Use separate browser profiles for the customer and admin. Customers start in **Cari Penjahit** and manage contact details in **Profil saya**. Admins open **Pengelolaan platform**, add partners and services, publish listings, and open incoming requests from **Papan pesanan**. Search the admin order queue by its reference, customer, tailor, or service. Customers can request a fitting and select pickup or delivery when submitting the request. They can confirm a revised fitting time on the order page. Admins can record delivery after checkout and close the order after handover. A new partner needs only a private WhatsApp number. Existing tailor logins can view their assigned work. The original cash workflow remains available for requests created before migration 006.

In **Papan pesanan**, **Perlu tindak lanjut** prioritizes unresolved complaints, fittings that need action, and work past the agreed finish date in WIB. The count and results reflect the current search. Open a row to see the order or the relevant fitting or complaint section.

Set `ADMIN_WHATSAPP` to the admin's international-format number to offer WhatsApp partner registration from the storefront. Without it, the storefront accepts a registration for admin review. For an order, **Bagikan ke grup WhatsApp** opens the chat chooser, and **WhatsApp pribadi mitra** opens the saved partner number. The admin sends the message in WhatsApp and records the reply on the order.

### Website checkout

The local stack uses `PAYMENT_MODE=demo`. Once work is ready, the customer starts a simulated payment and the admin records the test outcome. For a Midtrans BNI virtual account, use `PAYMENT_MODE=sandbox` or `live`, set the corresponding server-side `MIDTRANS_SERVER_KEY`, and configure the merchant notification URL to the public HTTPS origin followed by `/webhooks/midtrans`. The customer generates a bill on the website, transfers the quoted amount to the displayed virtual account, and checks the result on the order page. A signed callback triggers a server-side status check. Customers and admins can also refresh the gateway status from the order. Production use requires an activated merchant payment channel. [Midtrans bank transfer integration](https://docs.midtrans.com/docs/coreapi-core-api-bank-transfer-integration) · [Notification verification](https://docs.midtrans.com/docs/https-notification-webhooks)

**Pembayaran** shows the accepted total and checkout errors on the same screen. Check a pending bill from the order, or reload it if the virtual account number is still missing. Create a replacement from the same order once its previous bill fails or expires. Sandbox bills display instructions for a test transfer.

`PLATFORM_FEE_BPS` sets the commission in basis points. The default is 500 (5%). The accepted order locks the rate. A settled payment credits the platform commission and records the balance due to the partner, rounded in whole rupiah. The merchant handles partner disbursements. Test commission appears separately in the service performance table. [Test run guidebook](docs/TEST-RUN-GUIDEBOOK.md)

Use catalog search and categories to find a service. Admins can set category, estimated duration and intake guidance. Customers can specify quantity and fit notes, then add up to three private reference photos once the request is created. Admins record the tailor’s quote by line item, and the server calculates the total accepted by the customer. Photos are normalized to JPEG and stored in PostgreSQL. Real-data retention and backup approval remain pilot requirements.

### Rehearse in a fresh demo

1. Set the local `POSTGRES_PASSWORD` and `DEMO_PASSWORD` as above. Run `node scripts/sandbox.js 3166 3167` with two unused ports. The script prints a project name, the app URL, and the mailbox URL. It seeds synthetic accounts and workday orders with simulated messaging and payments.
2. Open `/health/ready` on the printed app URL and expect HTTP 200. Run `docker compose -p <project> ps web worker` using the printed project name. Expect the web and worker services to be running. The admin's **Operasional** page shows the worker's last heartbeat.
3. Use the demo accounts above and the same `DEMO_PASSWORD`. The customer opens **Pesanan Saya**, the admin opens **Pengelolaan platform**, and the existing tailor opens **Ruang usaha**. Use separate browser profiles to keep the sessions independent.
4. To refresh the demo passwords, rerun `docker compose -p <project> run --rm seed npm run db:seed -- --workday`. Use the app URL and password for that project. The seed preserves the existing workday orders.

For the admin, tailor and customer walkthrough from WhatsApp dispatch to completed handover, use the [end-to-end demo runbook](docs/DEMO-RUNBOOK.md).

### Run a private HTTPS preview

Use Docker with Compose v2 and a dedicated synthetic database. On first setup, copy `.env.preview.example` to `.env.preview` and set fresh `POSTGRES_PASSWORD` and `DEMO_PASSWORD` values. Use a `PREVIEW_IMAGE` tag for the revision under test. The example binds to loopback. The web and worker use the same HTTPS origin. [Preview Compose override](compose.preview.yaml)

For a Linux VM, point two DNS names to the VM's public address and allow inbound TCP 80 and 443 in the VM and cloud firewalls. Give Caddy those ports and set the following values in `.env.preview`, substituting your DNS names. The bind address shown is for IPv4. Caddy obtains HTTPS certificates for the two public hostnames. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)

```dotenv
PREVIEW_APP_HOST=preview.example.com
PREVIEW_MAIL_HOST=preview-mail.example.com
PREVIEW_BIND_ADDRESS=0.0.0.0
PREVIEW_HTTP_PORT=80
PREVIEW_HTTPS_PORT=443
```

Create the two credential files named in `.env.preview`. For each invited person, run `docker run --rm -it caddy:2.11.9-alpine caddy hash-password` and add one `username hash` line. Use distinct usernames across the files. The tester file grants access to the app, and the QA file grants access to both the app and the test mailbox. Keep both files and `.env.preview` in private configuration. [Caddy Basic Authentication](https://caddyserver.com/docs/caddyfile/directives/basic_auth)

On Bash, run the following from the repository root. On PowerShell, use `function preview { docker-compose --env-file .env.preview -f compose.yaml -f compose.preview.yaml @args }` and run the same five `preview` commands.

```sh
preview() { docker compose --env-file .env.preview -f compose.yaml -f compose.preview.yaml "$@"; }
preview config --quiet
preview build web
preview up -d --wait --no-build
preview run --rm seed npm run db:seed -- --workday
preview ps
```

From another network, open the app URL in a fresh browser session. Confirm HTTP redirects to HTTPS, the certificate is trusted, and the tester login reaches Marajut. The mailbox has its own QA gate. Share the app URL and individual gate logins privately. Reserve the seeded `DEMO_PASSWORD` for QA that needs access to every demo role, including admin. For customer-only tests, use a synthetic signup and have QA relay its verification code from the test mailbox.

In the loopback example, open the app at `https://localhost:3170` and the mailbox at `https://127.0.0.1:3170`. The test guide shows how to trust the loopback certificate for the smoke run. Preview payments and messaging use simulation. The proxy is the only service with published ports. [Preview verification and pilot steps](docs/TEST-RUN-GUIDEBOOK.md#rfc-0003-private-preview-and-pilot--26-november-2026-wib)

### Dispatch WhatsApp from the admin desk

Open a managed request and expand **Koordinasi penjahit → Kirim ke grup** or **Hubungi mitra**. Review the destination and message, then select **Konfirmasi kirim**. Record partner consent under **Kelola mitra** and group consent under **Operasional → Pengiriman WhatsApp**. A matched reply appears under **Riwayat WhatsApp**. The **Balasan WhatsApp** inbox holds replies and receipts that need review. Use the existing availability and quote controls to continue the order. [Dispatch setup and checks](docs/TEST-RUN-GUIDEBOOK.md#rfc-0004-whatsapp-dispatch--27-november-2026-utc)

## Demo inbound intake and handoff

1. Sign in as `customer2@marajut.test` and open **Pesanan Saya → Simulasi WhatsApp**. Send a message, choose **Ruang Jahit Dewi · Perbaikan jahitan lepas** (**Seam repair** on older seeds), and submit **Detail jahitan**.
2. If the sender is unlinked, choose **Tautkan pengirim**, send the proof and refresh. Select **Konfirmasi tautan** in the session that generated the code.
3. Choose **Minta bantuan penjahit**. As `tailor2@marajut.test`, open **Ringkasan → Percakapan WhatsApp**. Choose the conversation and select **Tangani percakapan**.
4. Send **Kirim balasan simulasi** and refresh the customer conversation to see it. Choose **Buat permintaan layanan** or link a matching existing request. The operator can handle unassigned conversations.
5. As the admin, open the linked request, record that the partner is available and send a quote. The customer accepts the displayed version in their signed-in workspace. Resolve the conversation or return it to automated intake from the tailor view.

The local adapter accepts normalized text, service selection, details, handoff and binding-proof events. The browser uses an authenticated fixture sender assigned to the demo customer. Programmatic fixtures can optionally set a separate `SIMULATION_WEBHOOK_SECRET` of at least 32 characters. In a local or test environment, post exact JSON bytes to `/simulated/webhooks/whatsapp` with `X-Simulation-Signature` containing a hexadecimal HMAC-SHA256 of those bytes. For example, the envelope can be `{"eventId":"fixture-1","sender":"fixture:customer","kind":"text","text":"I need help with a hem."}`. A matching retry returns the original receipt. Reuse of an event ID with changed data returns a conflict. This endpoint is registered only when the environment, mode and secret permit fixture traffic.

Binding requires both a short-lived proof echoed by the targeted sender and confirmation in the original authenticated browser session. Proof codes are shown once and stored only as digests. A binding can prepare a draft but does not create a login session or authorize any quote decision from chat.

After selecting a business, the conversation stays scoped to that business even if staff return it to automation. To choose another business, close the current intake or ask the handler to resolve it, then start a new message.

## Database and services

`compose.yaml` runs PostgreSQL 17, a one-shot migration command, the web app and the worker. The migrator runs before the web app and worker. Migration 001 creates users, sessions, businesses, memberships, services, inquiries, quotes, decisions, orders and events. Migration 002 creates simulation preferences, the outbox, deduplicated simulation receipts and worker heartbeats. Later migrations add account verification, the admin order workflow, payment records, fitting and delivery tracking, and the demo account rename. The migrator applies pending files to the PostgreSQL database you configure.

```sh
docker compose run --rm migrate
docker compose run --rm seed
docker compose logs web worker
docker compose exec db psql -U marajut -d marajut -c "SELECT mode, seen_at FROM worker_heartbeats;"
docker compose stop
```

The migrator stores checksums and applies pending files under a PostgreSQL advisory lock. Seed reruns refresh the fixture passwords and preserve service edits and business history. To rehearse from an empty database, use a fresh Compose project name and a different `APP_PORT`. For a PostgreSQL instance you provision separately, set standard `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `PGPASSWORD` variables. Run `npm ci`, `npm run db:migrate`, and `npm run db:seed` with `MARAJUT_ENV=local` and `DEMO_PASSWORD`. Start `npm start` and `npm run worker` in separate terminals. Align `PORT` and `APP_ORIGIN` with the browser URL when overriding defaults.

Health endpoints are `/health/live` and `/health/ready`. Readiness depends on the database and schema version. Browser forms and JSON clients share the same handlers. JSON clients first fetch `GET /api/v1/session`, retain the cookie and send the returned value as `X-CSRF-Token` on writes. Refresh the session endpoint after sign-in or logout, which rotates that token.

## Local pilot workflows

Customers can enter as guests from **Minta penawaran**, verify an email, optionally stage one private photo and send the verified request to the tailor. **Masuk** also provides standalone signup and password recovery. During local testing, get messages from the loopback MailCatcher inbox at [127.0.0.1:3101](http://127.0.0.1:3101/). Use a separate `MAIL_PORT` for each Compose project. The worker uses the fixture mailbox in local and test environments. A hosted environment requires its own approved SMTP service and HTTPS origin.

The seeded platform operator has a **Pengelolaan** workspace for invitations, publication and access revocation, exceptional cancellation and simulation delivery review. Existing local seeds can receive this demo capability with `docker-compose run --rm seed npm run db:seed -- --operator-access`. For requests created before migration 006, a tailor can still record cash received at pickup. Staff decisions and cash corrections have an audit trail.

Migration `005_pilot_workflows.sql` adds verification challenges, scoped staff permissions, order reviews, cash records, and structured simulated intake. The worker persists quote expiry and removes expired credentials and unclaimed verification drafts. Use the following commands in a disposable stack for maintenance rehearsal. The backup passphrase belongs in a separate secret store.

```sh
node scripts/sandbox.js 3122 3123
node scripts/db-backup.js save <project> <new-backup-file>
node scripts/db-backup.js rehearse <project> <backup-file>
docker compose -p <project> exec worker node apps/marajut/maintenance.js
```

An approved deployment can schedule encrypted backup creation and retain copies off-host. The maintenance command previews the draft 90-day closed-photo and 30-day abandoned-thread policies. Apply requires an approved policy and the explicit `--apply` switch with `MARAJUT_RETENTION_POLICY=approved-90-30`. Rehearse on synthetic data first.

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

The JavaScript build check runs syntax validation. There is no frontend bundler or separate type checker in this slice. The HTTP integration suite uses a random PostgreSQL test schema in the local Compose database and drops only the schema it created. It checks role and tenancy boundaries, request replays, quote races and expiry, order progress/history, and duplicated, failed or retried notifications. The Playwright smoke runs against the seeded local web service and worker and creates a synthetic rehearsal order. Set `BROWSER_CHANNEL=chrome` to use installed Chrome or leave it unset for Playwright Chromium. Set `BROWSER_SCREENSHOTS` to a local output directory to capture the completed-order views. Windows PowerShell installations that block `npm.ps1` can use `npm.cmd`.

## Messaging and release scope

`MESSAGING_MODE=simulated` queues quote and collection notices. The worker uses leased jobs, bounded retry and a durable per-intent simulation receipt. It checks the customer's simulation preference before recording a message. `MESSAGING_MODE=disabled` stops new intents. The adapter boundary allows a future vendor transport to declare replay behavior. Live mode is rejected and no Meta or BSP requests are sent.

Local pilots support pre-verified fixtures, verified guest accounts, password recovery, private photo uploads and operator-managed tailor invitations and publication. Automated WhatsApp API delivery requires an approved Business account and number, external HTTPS callback configuration, verified sender binding with real contacts, consent and template approval, receipt reconciliation and real delivery tests. The [SEVENT X checklist](docs/adr/ADR-0009-competition-eligibility.md#sevent-x-website-checklist) records the remaining eligibility and submission evidence.

## Local Git baseline

If this directory still has no Git history, first confirm the intended repository and check whether the team already has a canonical remote. For a new private history, initialize locally with `git init -b main`. Verify `.env`, dependency folders, and all local exports are ignored. Review intended files with `git add --dry-run .` and inspect `git diff --cached --stat` after staging an explicit file list. Commit the reconstruction with `LEGACY_ORIGIN.md` included. Keep the legacy ZIP in its existing archive and preserve any separately recovered Git history outside this baseline. No push is required.

## Changed files

| Area | Files |
| --- | --- |
| Local build and setup | `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `.dockerignore`, `compose.yaml`, `infra/Dockerfile` |
| Database and identities | `db/migrations/{001_core,002_messaging}.sql`, `apps/marajut/{db,migrate,seed,identity}.js` |
| Business and messaging | `apps/marajut/{catalog,inquiries,quotes,orders,outbox,worker}.js` |
| HTTP and UI | `apps/marajut/{app,server,errors,validation}.js`, `apps/marajut/views/*.ejs`, `apps/marajut/public/style.css` |
| Verification | `scripts/{check,browser-smoke}.js`, `tests/workflow.test.js` |
| Delivery docs | `README.md`, `LEGACY_ORIGIN.md`, `docs/roadmap/MARAJUT-IMPLEMENTATION-ROADMAP.md` |

See [RFC-0001](docs/rfc/RFC-0001-MARAJUT-RECONSTRUCTION.md), the [ADR register](docs/adr/README.md) and the [roadmap](docs/roadmap/MARAJUT-IMPLEMENTATION-ROADMAP.md) for remaining release work.
"# merajut" 
