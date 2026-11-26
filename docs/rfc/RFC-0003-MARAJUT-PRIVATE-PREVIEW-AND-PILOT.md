# RFC-0003 Marajut private preview and pilot

**Status** Preview setup implemented and tested on loopback · **Date** 26 November 2026 WIB · **Baseline** `main` at `7c7868f`

## 1. Release goal

Give the team a private HTTPS preview where an invited customer and admin can finish a synthetic tailoring order and rehearse the admin's WhatsApp coordination with the tailor. The release owner should be able to restart and restore that preview from a documented revision.

RFC-0002 verified demo sign-in, the admin follow-up queue, checkout recovery, and encrypted restore on a local stack. The next milestone is to repeat that evidence on the intended hosting setup and observe where testers get stuck. [RFC-0002](RFC-0002-MARAJUT-PILOT-READINESS.md) · [Published implementation](https://github.com/TheGoodEvil28/merajut/commit/7c7868ffb8706bb18d349b7566cca77b539a909e)

## 2. Implementation order

### 1. Deploy a private synthetic preview

- Release owner chooses a host that can run the Express web service and a persistent worker with HTTPS ingress, private PostgreSQL, and team access control. Use a dedicated preview database and deploy the web and worker from the same tested image. Run migrations before enabling either service.
- The current Compose stack sets a localhost origin. Add a preview override or equivalent host settings that pass the canonical HTTPS URL as `APP_ORIGIN` to both the web and worker. Verify that secure login cookies, form origins, and account links match the preview URL and that the proxy preserves per-client rate limiting.
- Gate the preview and its test mailbox to invited testers. Use synthetic accounts, demo payments, and simulated messaging. Provision passwords through the host's secret store, seed the dedicated database, and share fixture credentials privately. Keep the simulator webhook secret unset for the preview unless a specific authorized test needs it. [Local Compose stack](../../compose.yaml) · [Account mailer](../../apps/marajut/mail.js) · [Local setup](../../README.md#rehearse-in-a-fresh-demo)

### 2. Verify the hosted journey and recovery

- Run the existing integration suite and three browser walkthroughs against the local synthetic stack for the release candidate. The browser scripts are scoped to loopback. On the HTTPS preview, use fresh browser sessions as an invited tester to check customer, admin, and existing tailor sign-ins and a synthetic account verification or recovery email.
- Complete one customer booking with an agreed quote, a fitting change, a failed demo payment and retry, and delivery. Run a second order through pickup. Check the admin's follow-up filter and the order histories. Verify that a separate customer or shop is denied access to private order data outside their scope.
- Record web readiness and a recent worker heartbeat, then verify that the worker resumes after restarting it. Back up the preview database, restore the encrypted copy into a disposable target, and compare account, request, order, history and photo counts. Record the release revision, restore time, and recovery steps in the guide. [Local rehearsal](../TEST-RUN-GUIDEBOOK.md#rfc-0002-pilot-readiness--26-november-2026-wib) · [Backup and retention rehearsal](../TEST-RUN-GUIDEBOOK.md#t10--backup-and-retention-rehearsal)

### 3. Observe a small pilot

- Invite consenting customers, an admin, and a tailoring partner to work through synthetic orders. Have the admin prepare the group and private WhatsApp drafts and record the tailor's reply. The tailor participates through WhatsApp coordination, and the customer checks the website for the agreed price, fitting, payment, and handover.
- Record completion by role, time from request to issued quote, and where a participant needed assistance. Capture the device and step for each issue. Summarize the sample size and use the observed blockers to prioritize the next fixes.
- Before collecting real customer records, assign a support owner and agree on what contact and photo data the pilot needs, how long to retain it, and how to honor deletion requests. Keep the first evidence report on synthetic tasks and separate any later field measurements. [Authentication and retention decision](../adr/ADR-0007-authentication-and-retention.md)

### 4. Validate external integrations when approved

- For Midtrans, give a separate merchant sandbox environment a reachable HTTPS notification callback. With authorized sandbox credentials, verify a test bill, a repeated callback, and an expired bill followed by a retry. Check that the verified amount matches the accepted quote and contributes once to test commission.
- Treat official WhatsApp delivery as its own integration decision. Verify the approved number and access, sender consent, templates, and delivery receipts before relying on the adapter. The first pilot uses the current workflow where admins coordinate with tailors through WhatsApp drafts. [Checkout setup](../../README.md#website-checkout) · [WhatsApp integration decision](../adr/ADR-0004-whatsapp-integration.md)

## 3. Release checks

| Check | Evidence required |
| --- | --- |
| Private preview | An invited tester can reach the HTTPS URL from another network. Uninvited sessions meet the access gate. Only authorized staff can reach the test mailbox, and the database accepts connections from the preview services and authorized maintainers. Record the deployed revision and integration modes. |
| Order journey | Customer and admin finish both delivery and pickup on the preview. Mobile fitting and payment actions work by keyboard and on a phone. The existing tailor can view assigned work. |
| Recovery | After a restart the web returns ready and the worker sends a fresh heartbeat. A disposable restore has the expected counts. QA opens a known restored order and verifies its history. |
| Pilot findings | Record who participated by role, which tasks they finished, time to quote, and the issues to fix. Use these findings to decide whether to expand the pilot. |
| Competition submission | Verify written eligibility clearance and the website, repository, proposal, originality form, and demo video requirements before submission. [Competition requirements](../adr/ADR-0009-competition-eligibility.md) |

## 4. Decisions and owners

The release owner selects the host, access method, and backup destination first. Engineering prepares the deployment configuration and the recovery steps. The product lead recruits testers and assigns someone to handle support and privacy. The team lead owns organizer correspondence and the submission decision.

A working private preview and recovery rehearsal are the first deliverables. The pilot starts once testers can sign in and complete the hosted synthetic order journey. Merchant sandbox verification and official WhatsApp delivery depend on separate access and approval.

## 5. Local implementation evidence

The Compose preview uses Caddy for HTTPS and separate app and mailbox access. The web and worker share the preview origin, and PostgreSQL runs on an internal network. The loopback rehearsal covered the invitation gates, secure sessions, account links, delivery and pickup, and a restart with a fresh worker heartbeat. An encrypted restore returned the completed delivery's history through the order read model. Hosted access and observed pilot sessions remain release checks. [Preview setup](../../README.md#run-a-private-https-preview) · [Test run guidebook](../TEST-RUN-GUIDEBOOK.md#rfc-0003-private-preview-and-pilot--26-november-2026-wib)
