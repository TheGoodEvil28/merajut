# RFC-0002 Marajut pilot readiness

**Status** Implemented and verified locally · **Date** 26 November 2026 WIB · **Baseline** `main` at `c26850e`

## 1. Goal

Make the next Marajut update ready for a repeatable pilot rehearsal. A tester should be able to sign in on a fresh demo, a customer should know what to do when checkout stalls, and an admin should be able to find orders that need attention.

The baseline covers service discovery, quote revisions, fittings, website checkout, pickup or delivery, and order history. Its checkout tests use simulated payments and gateway fixtures. Admins manage listings and open WhatsApp drafts to coordinate with accountless partners. CI on the baseline passed 21 integration tests and three browser walkthroughs. [Order walkthrough](../TEST-RUN-GUIDEBOOK.md#customer-and-admin-order-walkthrough--26-november-2026-wib) · [GitHub Actions run](https://github.com/TheGoodEvil28/merajut/actions/runs/45688883830)

## 2. Implementation order

### 1. Make demo access repeatable

- Start from the existing Compose sandbox command and workday seed. Document how to identify the correct app port, verify readiness and the worker, and seed the customer, admin, and existing tailor accounts before sign-in.
- Use the ready-to-pay order in the existing workday seed. In disposable test fixtures, set past dates on a booked fitting and an accepted order after creating them through the normal workflow. Verify that rerunning the seed preserves existing requests and order history.
- Verify that a customer who signs in from a listing returns to the selected service, an admin lands on the order board, and an existing tailor opens their own workspace. Keep fixture passwords in local configuration and share preview credentials privately. [Sandbox command](../../scripts/sandbox.js) · [Workday fixtures](../../apps/marajut/demo-workday.js)

### 2. Show orders that need admin follow-up

Add a **Perlu tindak lanjut** filter to **Papan pesanan**. Derive the reason from the existing order, fitting, and complaint records. Show the reason and relevant date beside the existing next action. When a record matches several rules, use the highest reason in the table.

| Priority | Order condition | Admin action |
| --- | --- | --- |
| 1 | An unresolved complaint is recorded. | Open the complaint and record its resolution. |
| 2 | The customer requested a new fitting time, or a scheduled or proposed fitting time has passed on an active order. | Propose a new time for a reschedule request or expired proposal. For a missed confirmed appointment, check with the tailor and record completion or propose a new time. |
| 3 | Accepted work is confirmed or in progress and its agreed completion date is earlier than today in WIB. | Confirm the progress with the tailor and update the order through its existing controls. |

Use the same predicates for the filter count and results. Preserve search across order code, customer, shop, and service. Within each priority, show the oldest request first with a stable tie-breaker for pagination. Rehearse the mobile filter and the same actions at desktop width. [Admin queue query](../../apps/marajut/dispatch.js) · [Order board](../../apps/marajut/views/desk-overview.ejs)

### 3. Clarify checkout recovery

- Put checkout and verification errors beside **Pembayaran**, with the accepted total and a clear next step. If a bill is pending, direct the customer to check its status. If the bill expired or failed, direct them to create a replacement from the same order.
- Reuse the current payment commands and the commission rate locked on the order. Repeated checks or callbacks should preserve one settlement and one contribution to commission totals. For admin-managed orders, verified payment unlocks pickup completion or delivery recording.
- Exercise the same bill after a transient gateway failure, a failed bill followed by a retry, and an attempted handover before settlement. Keep the customer and admin labels consistent for demo and sandbox transactions. [Payment commands](../../apps/marajut/payments.js) · [Payment view](../../apps/marajut/views/order-payment.ejs)

### 4. Rehearse the release

- Start an isolated synthetic stack from a clean checkout. Run the build, Compose integration suite, and all three browser walkthroughs. Rehearse an encrypted restore and confirm the restored accounts, requests, and order history are readable.
- Once a host is available, use a private HTTPS preview with the web app and worker from the same revision, a separate PostgreSQL database, and synthetic data. Verify sign-in, worker health, and the full order journey in a fresh browser session. Record the preview URL, tested commit, and payment mode in the test run guidebook.
- Rehearse the operating sequence with the admin opening WhatsApp drafts and recording simulated replies while a customer completes an order. Keep customer contact details in the protected order view. Use simulated payments for the first rehearsal. A Midtrans merchant sandbox run needs approved credentials and a reachable HTTPS callback. An official WhatsApp integration needs its own approval and delivery evidence. [Local setup and modes](../../README.md) · [Backup rehearsal](../TEST-RUN-GUIDEBOOK.md#t10--backup-and-retention-rehearsal)

## 3. Acceptance checks

| Scenario | Pass condition |
| --- | --- |
| Fresh demo access | Separate sessions reach the customer, admin, and existing tailor workspaces. Seed reruns preserve workday records and a sign-in from discovery resumes the selected service. |
| Admin follow-up | Seeded complaints, fitting changes, missed fittings, and late orders appear under the correct reason. Search and pagination agree with filter counts. Resolving the condition removes the order from follow-up unless another reason still applies. |
| Customer order | A customer submits a request, reviews and accepts the quote and fitting details, and retries a failed test payment. Verify both pickup and delivery scenarios through handover and customer history. |
| Access and history | Only authorized order participants can open private photos. The admin's contact view stays restricted to the admin role. The existing tailor can read their assigned managed orders and complete an order in the earlier cash flow. |
| Release evidence | Record the commit, configured modes, test results, restore result, and any external checks still pending. Check the key actions by keyboard and at 360 px and desktop widths. |

## 4. Ownership and release decisions

Product and operations should confirm which orders need follow-up and who checks that queue. Engineering owns the queue, checkout and fixture changes. The release owner selects the preview environment, and QA rehearses the customer and tailor paths with an admin.

For a consenting pilot, record task completion and the time from inquiry to an issued quote. State the sample size and whether the records came from a rehearsal or a real pilot. Keep the SEVENT X SDG 8 evidence tied to observed use. Competition submission remains conditional on written organizer clearance and the required artifacts. [Eligibility and submission checklist](../adr/ADR-0009-competition-eligibility.md)

## 5. Local rehearsal results

The local rehearsal verified fresh sandbox sign-ins, repeatable seeding, follow-up filtering, and checkout recovery. It passed 22 integration tests, three Chromium walkthroughs, and an encrypted restore. The private HTTPS preview remains a release step once a host is selected. [Test run guidebook](../TEST-RUN-GUIDEBOOK.md#rfc-0002-pilot-readiness--26-november-2026-wib)
