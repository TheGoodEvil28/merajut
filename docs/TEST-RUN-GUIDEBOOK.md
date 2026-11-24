# Marajut test run guidebook

Update this guide with every change. Record the affected roles, prerequisites, steps, expected results, verification method, and any unverified behavior.

## Before testing

- Open [Marajut](http://127.0.0.1:3100/) and check [readiness](http://127.0.0.1:3100/health/ready). The hosted legacy reference has a separate deployment. Existing fixture logins and the Compose project still use the Djahit technical names.
- From the project directory, start a stopped local app with `docker-compose up -d --wait`. To refresh it after source changes, run `docker-compose up -d --wait --build`. For fixture accounts, run `docker-compose run --rm seed`.
- To demonstrate several tailor work states on a **disposable demo database**, run `docker-compose run --rm seed npm run db:seed -- --workday`. The examples are marked as demo and use ordinary domain commands. Repeating the command leaves those existing examples in their current state.
- Use separate Chrome profiles or regular and private windows for each role. Fixture accounts use the local `DEMO_PASSWORD`. Give a new request a unique synthetic tag.

| Account | Role |
| --- | --- |
| `customer@djahit.test` | Customer for the web request |
| `tailor@djahit.test` | Jahit Rina tailor |
| `customer2@djahit.test` | Customer for simulated WhatsApp |
| `tailor2@djahit.test` | Ruang Jahit Dewi tailor |
| `operator@djahit.test` | Platform triage for unassigned handoffs |

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

1. As `customer2@djahit.test`, open **Pesanan Saya → Simulasi WhatsApp**. Send a simulated message, choose **Ruang Jahit Dewi · Perbaikan jahitan lepas** (**Seam repair** on older seeds), and send tailoring details. Use **Muat ulang** after submitting delayed events.
2. If needed, choose **Tautkan pengirim**, send the proof and complete **Konfirmasi tautan** in the same session. The draft becomes available. Select **Minta bantuan penjahit**.
3. As `tailor2@djahit.test`, open **Ringkasan → Chat WhatsApp · simulasi**. Check the conversation source label, open it, select **Tangani percakapan**, and send a reply. The customer sees a **Balasan simulasi**.
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

Use a seeded disposable stack and its local MailCatcher inbox. The default inbox is at [127.0.0.1:3101](http://127.0.0.1:3101/). Use a unique `@djahit.test` address and keep proof codes within the test session.

1. Signed out, choose a service, fill in the request and email, and select **Simpan draf dan verifikasi email**. Add an optional synthetic JPEG or PNG on the confirmation page.
2. Check the tailor's inbox before confirming. The draft and photo should be absent. Open the confirmation link or copy its code from the local inbox, choose **Periksa tautan**, review the draft and set your name and password. An existing customer uses their current password.
3. Select **Konfirmasi dan kirim permintaan**. Expect one request and its reference photo. The assigned tailor can view them. Reusing the proof or opening the new order with another account must fail.
4. In a fresh browser session, ask for **Lupa kata sandi?** and use the latest recovery message. After setting a new password, the original session must return to sign-in. The new password opens the same order history.
5. For a standalone customer account, select **Daftar sebagai pelanggan** on the sign-in page and follow the email proof. Expect an empty **Pesanan Saya** workspace.

## T9 · Staff, orders and maintenance

1. As `operator@djahit.test`, open **Pengelolaan → Undang usaha baru**. Enter a synthetic email and re-enter the operator password. As the invitee, open the local invitation and set a password. Add an active service as the new tailor. The shop must stay out of public discovery until the operator publishes it with a reason.
2. As the customer, check the newly published shop and submit a request. Send a quote as the tailor. The customer's **Tanyakan rincian penawaran** returns it for review and removes acceptance on that revision. An expired revision also becomes unavailable and the worker writes its expiry to the timeline. Send a new quote and have the customer accept it.
3. Move the accepted order to **Siap diambil**. As the tailor, record cash only after confirming receipt. As the customer, check **Catatan tunai** and the separate work status. Void the receipt with a reason and check that the timeline shows the correction.
4. As the tailor, use **Ajukan pembatalan kepada pengelola** on an active or ready order. Review as the operator. Approval must fail while a cash receipt is current. After the receipt is corrected and approval recorded, both parties see **Dibatalkan**. Use a reason appropriate for both parties to read.
5. Revoke the invited tailor as the operator. The shop disappears from public discovery and the tailor's old session and sign-in cease to grant access. The customer can still open their own request.
6. Repeat T2, with quantity and fit notes entered under **Lengkapi permintaan**. Check that the values transfer to the linked inquiry. Use **Lepas tautan pengirim** from the customer simulator and check that the previous history remains with the original customer.

## T10 · Backup and retention rehearsal

Use a disposable Compose project. Run `node scripts/sandbox.js 3122 3123` with two unused ports for a clean workday seed. The script prints a new project name and its two URLs. It creates a separate volume each run.

Set `DJAHIT_BACKUP_PASSPHRASE` to a generated secret of at least 24 characters in the current shell. Save with `node scripts/db-backup.js save <project> <new-file>` and rehearse with `node scripts/db-backup.js rehearse <project> <file>`. Compare schema, request/order counts and photo bytes. An incorrect key must fail before temporary database creation. The restore removes its temporary database and scratch dump after verification.

Run `docker-compose -p <project> exec worker node apps/djahit/maintenance.js` for a count-only preview. In the isolated automated suite, age a closed request's photo past 90 days and run apply. Expect only the eligible image to disappear, with the order and timeline retained. The main demo uses preview mode for historical data.

## T11 · Marajut discovery and workspace

Use a fresh synthetic stack with the workday seed, the local mailbox and two separate Chrome sessions. Set `APP_ORIGIN` and `MAIL_ORIGIN` to that stack before running the browser scripts. For the web path use Ayu and Rina. For the chat path use Bima and Dewi.

| Role | Reproducible action | Expected result |
| --- | --- | --- |
| Guest | Open the homepage at 320 px, 360 px and desktop width. Tab to **Lewati ke konten**. Select **Cari Penjahit**, use a category and open a shop. Then use **Cara kerja** to read the ordering steps. | The wordmark and Masuk share the top row. Links remain reachable. The steps explain where to provide details, accept the price and track the work. Public cards show the shop’s own listings. |
| Guest → customer | Use **Coba chat WhatsApp (simulasi)** in the hero or **Buka simulasi WhatsApp** in Cara kerja. Sign in as Bima. Follow T2. | Sign-in explains the simulation and returns directly to it. Messages stay inside Marajut. The selected service and scope follow the converted request. |
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
| 19 November 2026 | Marketplace and workday redesign on disposable Compose project `djahit-studio-qa`, port 3115, with workday fixtures. Ran `npm.cmd run build`, `docker-compose -p djahit-studio-qa run --rm test`, `npm.cmd run test:browser` and `npm.cmd run test:inbound-browser` with Chrome. | Build and all 15 PostgreSQL/HTTP tests passed. Both Chrome walkthroughs passed. Verified category/search reset, sign-in continuity, mobile shop navigation and queue switching, clarification, private photo, itemized quote, customer action grouping, pickup, completion and the simulated handoff. Confirmed the guest header stays on one row at 320, 360, 768 and 1366 px and the keyboard skip link moves focus to main. |

After the QA run, the primary project was rebuilt with `docker-compose -p djahit up -d --wait --build`. On port 3100 the readiness check passed, the new catalog and visual assets loaded, and both fixture roles signed in to their respective workspaces. The primary database contained five inquiries and four orders before and after the rebuild.

Visual checkpoints from that run show the [desktop marketplace](product/evidence/studio-market-desktop.png), [mobile marketplace](product/evidence/studio-market-mobile.png), [tailor desktop](product/evidence/studio-workspace-desktop.png), [tailor mobile](product/evidence/studio-workspace-mobile.png) and [customer action list](product/evidence/studio-orders-mobile.png). Walkthroughs used automated Chrome sessions with synthetic records. Physical devices, screen-reader sessions and usability sessions with working tailors have yet to be tested. The [earlier quote editor checkpoint](product/evidence/structured-quote-editor.png) documents the structured quote workflow.

### Migration 005 · 19 November 2026 WIB

| Environment | Checks run | Observed result |
| --- | --- | --- |
| Disposable Compose project `djahit-pilot-qa`, ports 3120 and 3121 | Build, PostgreSQL integration suite, and all three Chrome walkthroughs | All 19 integration tests passed. Chrome completed the regular order, simulated WhatsApp handoff, and invited-tailor and verified-guest journeys. The pilot walkthrough used the local SMTP service and confirmed standalone signup, quote questions and revision, receipt display, password reset and loss of the old session. |
| Same Chrome pilot run | axe-core WCAG A/AA rules on marketplace, signup, management and order screens | Zero violations in the checked states. The last local walkthrough observed 289 ms for the marketplace load and 40 ms for signup. Those timings are a loopback sample. |
| Disposable backup rehearsal | Encrypted save, restore, wrong-key check | Restored schema 005, nine requests, six orders and two photos containing 548 bytes. A wrong key was rejected before restore. |
| Fresh sandbox on ports 3122 and 3123 | Sandbox create, seed, readiness and retention preview | New isolated stack reached readiness. Preview returned zero eligible historical records. The integration suite separately verified that an aged image could be removed while the cancelled order and audit remained readable. |
| Rebuilt QA containers | Graceful Docker stop after switching the web and worker entrypoints to Node | Web, worker, mail and database exited with status 0. The primary deployment reached readiness with the same entrypoints. |
| Primary Compose project `djahit` | In-place migration, readiness, mailbox, sign-in smoke | Migration 005 applied to the original volume. Customer, tailor and platform operator signed in. Five inquiries and four orders were present before and after. |

Screenshots show [guest confirmation](product/evidence/pilot-verifikasi.png), [platform management](product/evidence/pilot-pengelola.png), and [cash receipt in the customer workspace](product/evidence/pilot-tunai.png).

The operator notification-retry control remains unverified in Chrome. The CI workflow was added to the workspace and has not run on GitHub. Production email, official WhatsApp delivery, off-host backup scheduling, field usability and real-data retention remain unverified. Historical retention was not applied to the primary volume.

### GitHub repository push · 24 November 2026 WIB

Role affected is the repository maintainer. Use a local checkout on `main` and a GitHub credential with write access to `TheGoodEvil28/merajut`.

1. Run `git remote -v`. Expect both fetch and push URLs for `origin` to point to `https://github.com/TheGoodEvil28/merajut.git`.
2. Run `git push --dry-run origin main`. For the initial push, expect Git to report that it will create `main`.
3. Run `git push -u origin main`. Compare `git rev-parse HEAD` and `git ls-remote origin refs/heads/main`. Expect matching commit hashes and `main` to track `origin/main`.

Checked both remote URLs after updating `origin`. The remote had no `main`, and the dry run reported a new branch. Customer and tailor flows and GitHub Actions were not exercised for this repository change.
