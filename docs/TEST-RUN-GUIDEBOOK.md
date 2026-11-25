# Marajut test run guidebook

Update this guide with every change. Record the affected roles, prerequisites, steps, expected results, verification method, and any unverified behavior.

## Marajut naming and SEVENT X verification · 26 November 2026 WIB

**Roles and setup.** Use a guest, customer, tailor and platform admin against a disposable Marajut database. Maintainers can repeat the upgrade and restore checks. Copy `.env.example`, set synthetic passwords and choose unused loopback ports. Build once with `docker compose -p marajut-naming-qa build web`, start with `docker compose -p marajut-naming-qa up -d --wait --no-build` and run `docker compose -p marajut-naming-qa run --rm seed npm run db:seed -- --workday`. Use `docker-compose` where that is the installed command.

| Step | Action | Expected result |
| --- | --- | --- |
| Repository and screenshots | Search current filenames and file contents for the former branding, including hidden files. Inspect the archived screenshots and storefront images with OCR and check local image links in Markdown. | Current files use Marajut. Archived images with the previous wordmark are gone, and all retained image links resolve. The competition record gives the earlier entry and archive checksum in neutral terms. |
| Branding and sign-in | Open the local marketplace and `/health/ready`. Sign in separately with `customer@marajut.test`, `operator@marajut.test` and `tailor@marajut.test` and the stack's demo password. | Readiness is 200. Marajut is used in the app, package, worker output, account mail and demo addresses. The customer, admin and tailor each reach their own workspace. |
| Role regressions | Set `APP_ORIGIN`, `MAIL_ORIGIN`, `DEMO_PASSWORD` and `BROWSER_CHANNEL=chrome` for the disposable stack. Run `node scripts/browser-smoke.js`, `node scripts/inbound-browser-smoke.js`, `node scripts/pilot-browser-smoke.js` and `docker compose -p marajut-naming-qa run --rm test`. | The customer completes fitting, simulated payment and delivery, the admin records the workflow, and an existing tailor retains scoped access. Guest verification, quote revision, pickup and simulated chat conversion work. |
| Database upgrade | On synthetic data at migration 007, record the IDs and related records for the five original demo accounts. Apply migration 008 twice. Repeat with an occupied address, a role mismatch and an unrelated address. On a separate snapshot, rerun with the previously recorded 008 checksum, then try an unexpected checksum. | Eligible demo addresses change in place with their UUIDs, password digests, memberships and orders intact. Existing owners and unrelated accounts keep their addresses. The migrator accepts the approved 008 checksums and rejects an unrecognized checksum. |
| Backup and rehearsal | Set `MARAJUT_BACKUP_PASSPHRASE` and run the backup and restore rehearsal below on the isolated Compose project. Check both the current format and a synthetic file with the prior format. | Both encrypted backups authenticate and restore into a temporary database. The report gives the same schema and fixture counts for both. |
| Competition documents | Compare the [eligibility checklist](adr/ADR-0009-competition-eligibility.md#sevent-x-website-checklist) with pp. 9–11 and 14 of the supplied rulebook. | The checklist identifies the chosen subtheme, prior-work disclosure, tested functionality and remaining submission materials. |
| GitHub publication | With write access to `origin`, run `npm.cmd run build`, `docker-compose config --quiet` and `git diff --cached --check`. Validate the staged files and use Marajut in the commit title and description. Push `main`, then compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/main`. | The checks pass, local secrets and backup files stay outside the commit, and both hashes match. |

**Checks run.** Built the image from the renamed source with `npm ci`, started the separate Compose stack on ports 3164 and 3165, and confirmed readiness and Marajut startup logs. JavaScript syntax and Compose validation passed. All 21 integration tests and all three Chrome smoke paths passed, including the pilot's automated axe checks. A separate 007-to-008 upgrade test verified unchanged customer and tailor IDs, password digests, history and memberships, an occupied-address case, and sign-ins using the new addresses. Both backup formats restored seven requests and four orders at schema 008. GitHub repository metadata confirmed public visibility.

**Naming cleanup checks.** Ran `npm.cmd run build`, all 21 PostgreSQL and HTTP tests, and all three Chrome walkthroughs on the new isolated stack on ports 3166 and 3167. Fresh and previously applied migrations passed in disposable schemas. The five accounts kept their UUIDs, password digests, order history and memberships. Role mismatches and address conflicts stayed intact. Unexpected checksums for 001 and 008 were rejected. Both encrypted backup formats restored ten requests, seven orders and two photos with matching byte counts. Scanned current file contents, filenames and Markdown image links. OCR identified ten archived screenshots for removal and found no remaining matches in the retained screenshots or storefront WebP assets. Existing hosted builds and Git history were outside the verification scope.

**Publication preflight.** Repeated the JavaScript build check, Compose validation and staged whitespace check. The staged filename and content scan passed. The local environment file remained ignored and the staged tree contained no database backups or key files.

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
