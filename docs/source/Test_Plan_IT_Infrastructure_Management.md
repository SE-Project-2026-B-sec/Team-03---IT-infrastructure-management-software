# Software Test Plan (STP)

**Project:** IT Infrastructure Management Software
**Version:** 2.0
**Authors:** Team 03 QA (SE Project 2026, Section B)
**Date:** 22-10-2026
**Status:** Baseline for evaluation
**Repository:** [SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software)

---

## 1. Introduction

**Purpose:** This plan defines how the IT Infrastructure Management Software (ITIM) v1.0 is tested: objectives, scope, strategy, environment, schedule, responsibilities, and the concrete test cases that verify every requirement in the SRS.

**Scope:** All 27 SRS requirements: 16 functional (IT-F-001 to IT-F-016), 6 non-functional (IT-NF-001 to IT-NF-006) and 5 security (PRJ-SR-001 to PRJ-SR-005). Every test case in section 13 is automated and runs in the CI pipeline on each push and pull request.

**References:** [SRS v2.0](SRS_IT_Infrastructure_Management.md) (including the RTM), [SAD v2.0](SAD_IT_Infrastructure_Management.md), ISO/IEC/IEEE 29119-3, OWASP ASVS 4.0, WCAG 2.1.

**Definitions:** SUT (system under test), RTM (Requirements Traceability Matrix), UAT (User Acceptance Testing), p95 (95th-percentile latency), CI (continuous integration).

---

## 2. Test Items

| Item | Source |
| :--- | :--- |
| Authentication, JWT and RBAC | `src/services/users.js`, `src/security/jwt.js`, `src/security/rbac.js` |
| Hardware asset module (incl. barcode, depreciation, maintenance, decommissioning) | `src/services/hardware.js`, `src/services/barcode.js` |
| Software license module and key vault | `src/services/licenses.js`, `src/security/vault.js` |
| Endpoint telemetry and compliance module | `src/services/compliance.js` |
| Procurement module | `src/services/procurement.js` |
| Alerts, notifications and reports | `src/services/alerts.js`, `src/services/notifications.js`, `src/services/reports.js` |
| HTTP layer, validation, rate limiting | `src/app.js`, `src/routes.js`, `src/http/*`, `src/lib/validate.js`, `src/security/rate-limiter.js` |
| Persistence, audit log and backups | `src/store/*` |
| Dashboard | `public/*` |

---

## 3. Features to be Tested

Features mapped to SRS requirement IDs:

- IT-F-001 Register hardware asset; IT-F-002 Check-out / check-in; IT-F-003 Barcode label and scan lookup; IT-F-004 Depreciation.
- IT-F-005 License pools; IT-F-006 Seat allocation without over-allocation; IT-F-007 Manifest ingestion and reconciliation; IT-F-008 Blacklisted software detection.
- IT-F-009 Requisition submission; IT-F-010 Three-tier approval; IT-F-011 Purchase order and delivery onboarding.
- IT-F-012 Under-licensing alert; IT-F-013 Expiry alerts; IT-F-014 Compliance report.
- IT-F-015 Maintenance logging; IT-F-016 Decommissioning.
- IT-NF-001 Performance; IT-NF-002 Reliability; IT-NF-003 Scalability; IT-NF-004 Audit trail; IT-NF-005 Accessibility; IT-NF-006 Disaster recovery.
- PRJ-SR-001 TLS; PRJ-SR-002 Authentication and RBAC; PRJ-SR-003 Key protection; PRJ-SR-004 Input validation and hardening; PRJ-SR-005 Brute-force and rate limiting.

---

## 4. Features Not to be Tested

- The endpoint agent program (out of scope; the agent API is tested with simulated agents).
- Email or chat delivery of notifications (not implemented; in-app notifications are tested).
- Physical barcode scanner hardware (scanners act as keyboards; the encoding is verified by decoding labels and was cross-checked with the ZXing decoder).
- 99.9% monthly availability (an operational measurement; the mechanisms behind it are tested in TC-REL-01).
- Production TLS certificates issued by a public CA (TLS behaviour is tested with a self-signed certificate).

---

## 5. Test Approach / Strategy

### 5.1 Test Levels

1. **Unit tests:** pure functions tested directly, for example `computeDepreciation`, the barcode decoder, the expiry bucketing and AES-GCM tamper detection.
2. **Integration tests:** most test cases start the real HTTP server on a random local port, in-process, with test secrets, and drive it through `fetch`. This exercises routing, authentication, RBAC, validation, services and the store together.
3. **System tests:** TC-REL-01 starts the production entry point (`node src/index.js`) as a separate process and sends it SIGTERM; TC-DR-01 and TC-AUDIT-01 use real data files on disk; TC-SEC-01 performs real TLS handshakes. The CI staging stage then deploys the packaged build and runs `scripts/smoke.js` against it.
4. **Acceptance tests (UAT):** the course evaluator and team walk through the dashboard with the demo accounts, using the acceptance criteria in SRS section 4 as the checklist.

### 5.2 Test Types

- **Functional** (positive and negative): every FR test checks the success path and the specified error codes.
- **Boundary:** zero and fractional seats, last available seat, 100 KB body limit, 5th and 6th login attempt, expiry thresholds at 60, 30 and 7 days.
- **Concurrency:** 10 simultaneous allocation requests for 3 seats (TC-SAM-02).
- **Performance and scalability:** 50 concurrent clients (TC-PERF-01); 50,000 assets and 100,000 seats (TC-SCALE-01).
- **Reliability and recovery:** fault isolation, graceful shutdown, crash recovery, backup restore (TC-REL-01, TC-DR-01).
- **Accessibility:** automated WCAG 2.1 AA checks (TC-UX-01).
- **Regression:** the full suite runs on every push and pull request on Node.js 18, 20 and 22.
- **Security validation:** see below and TC-SEC-01 to TC-SEC-05.

**Security validation**

- TLS 1.3 enforcement, HSTS and HTTP-to-HTTPS redirect.
- JWT tampering, `alg=none`, expired and wrongly signed tokens; cross-role access attempts.
- Product-key masking in every response, encrypted storage, reveal permission and audit.
- Unknown fields, prototype pollution, markup injection, non-JSON bodies, oversized bodies, path traversal, CSV formula injection.
- Brute-force lockout and API rate limiting.
- Static analysis with ESLint security rules (`npm run sast`) and dependency audit (`npm audit`) in CI stage 2; CodeQL on public repositories.

### 5.3 Entry and Exit Criteria

**Entry criteria**

- `npm run lint` and `npm run check:docs` pass (CI stage 1).
- Test environment available: Node.js 18.18 or later; `openssl` on the path for TC-SEC-01.
- Test data is created by each test (demo users are seeded automatically on start).

**Exit criteria**

- 100% of the test cases in section 13 executed.
- 100% passed, with no skipped security test in CI.
- No open defect of severity Critical or High.
- Every SRS requirement maps to at least one passing test case (checked automatically by `scripts/check-docs.js`).
- The CI pipeline is green on the main branch, including the staging smoke test.

---

## 6. Test Environment

| Component | Specification |
| :--- | :--- |
| Hardware | GitHub-hosted runner (`ubuntu-latest`) or a developer laptop |
| Operating system | Ubuntu (CI); macOS and Windows supported for local runs |
| Runtime | Node.js 18.x, 20.x and 22.x (CI matrix) |
| Test framework | Node.js built-in runner `node:test` with `node:assert`; no third-party test libraries |
| Tools | `openssl` (test certificates), ESLint 9 with `eslint-plugin-security`, `npm audit`, CodeQL |
| Test data | Demo users for every role seeded on start (password configured by the tests); assets, licenses and requisitions created by each test; temporary data and backup files in the OS temp directory, removed afterwards |
| Defect tracking | GitHub Issues |

---

## 7. Test Schedule

| Milestone | Date | Deliverable | Owner |
| :--- | :--- | :--- | :--- |
| Test plan baseline | 22-10-2026 | This document (v2.0) | QA Lead |
| Automated suite complete | 22-10-2026 | 27 test cases in `tests/`, passing locally on Node 18, 20 and 22 | Test Engineer |
| CI pipeline green | On first push to the repository | Workflow run with all five stages passing | DevOps |
| UAT walkthrough | 27-10-2026 to 29-10-2026 | Signed-off acceptance checklist; manual screen-reader review for IT-NF-005 | Team and Evaluator |
| Test summary report | 30-10-2026 | Final test summary using the CI artifacts | QA Lead |

---

## 8. Test Deliverables

- This test plan.
- Automated test scripts: `tests/*.test.js` and the shared helper `tests/helpers.js`.
- Test execution logs: TAP output (`test-results/results.tap`) and coverage output uploaded as CI artifacts for each Node version.
- Performance and scalability measurements printed as test diagnostics in the CI log.
- Defect reports (GitHub Issues).
- Test summary report.

---

## 9. Roles and Responsibilities

| Role | Name | Responsibility |
| :--- | :--- | :--- |
| QA Lead | <Name> | Maintain the plan and RTM, review results, sign off |
| Test Engineer | <Name> | Write and maintain automated tests, investigate failures, log defects |
| Developer / DevOps | Dilipan Y | Fix defects, maintain the CI pipeline |
| Product Owner | Course Evaluator | Approve results and readiness |

---

## 10. Risks and Mitigation

| Risk | Mitigation |
| :--- | :--- |
| Timing-based tests (performance, scalability) are slower on shared CI runners | Budgets include generous headroom (measured p95 is roughly 10 times below the limit); measured values are logged so trends are visible |
| `openssl` missing on a developer machine | TC-SEC-01 reports as skipped locally; CI runners always provide `openssl`, and a skip in CI counts as a failure of the exit criteria |
| A failing assertion leaves a server running and hangs the run | Every test that starts its own server stops it in a `finally` block or `after` hook; CI jobs have a timeout |
| Tests depending on each other's data | Each test file starts its own server with an empty store |

---

## 11. Assumptions & Dependencies

- Node.js 18.18 or later is installed; no network access is needed to run the tests.
- Local ports can be opened on 127.0.0.1 (random free ports are used).
- The CI runner can download the dev dependencies (ESLint) from npm for stages 1 and 2.

---

## 12. Suspension & Resumption Criteria

Suspend testing if:

- the build or lint stage fails (tests do not start);
- more than 30% of test cases fail, which indicates an environment or build problem rather than individual defects;
- the documentation integrity check fails (requirements and tests are out of sync).

Resume testing when the blocking problem is fixed and the stage passes again.

---

## 13. Test Case Management & Traceability

Each test case has one or more automated tests whose names begin with the test case ID, so failures in the CI log point straight back to the requirement. `scripts/check-docs.js` fails the pipeline if any requirement lacks a test case or any test case lacks an automated test.

### Suite 1: Hardware asset management

| Test Case ID | Requirement ID | Title | Pre-conditions | Steps | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-HAM-01 | IT-F-001 | Register asset with generated tag; reject duplicates and invalid data | Logged in as IT Admin | 1. POST `/api/v1/assets` without a tag. 2. Register a second asset. 3. Register with an explicit tag, then repeat tag and serial. 4. Send invalid cost and category. 5. Try as Technician. | 1. 201, tag `HW-YYYY-NNNNNN`, status `AVAILABLE`. 2. Different tag. 3. 201, then 409 for both. 4. 400 listing 2 errors. 5. 403. | `tests/hardware.test.js` | Pass |
| TC-HAM-02 | IT-F-002 | Check out and check in | Available asset; employee EMP-0101 exists | 1. Check out to EMP-0101. 2. Check out again. 3. Employee lists own assets. 4. Check in, then check in again. 5. Check out to EMP-9999. 6. Read the employee directory as Technician and as Employee. | 1. 200, `IN_USE`. 2. 409. 3. Asset listed. 4. 200 `AVAILABLE`, then 409. 5. 404. 6. 200 with only ID, name and department; Employee gets 403. | `tests/hardware.test.js` | Pass |
| TC-HAM-03 | IT-F-003 | Barcode label and scan lookup | Asset tagged `HW-QR-001` | 1. GET `label.svg`. 2. Decode the bar widths. 3. GET `by-tag/hw-qr-001`. 4. GET an unknown tag. | 1. 200 `image/svg+xml`. 2. Decodes to `HW-QR-001` with a valid checksum. 3. 200, same asset. 4. 404. | `tests/hardware.test.js` | Pass |
| TC-HAM-04 | IT-F-004 | Straight-line and WDV depreciation | Asset cost 1200 bought 22-10-2024 | 1. SL with salvage 200, life 5, as of 22-10-2026. 2. WDV with rate 0.25. 3. As-of date before purchase. 4. Unit checks of edge cases. | 1. Age 2, 200 per year, accumulated 400, book 800. 2. Book 675. 3. 400. 4. Never below salvage; invalid salvage, life or age rejected. | `tests/hardware.test.js` | Pass |

### Suite 2: Software license management and compliance

| Test Case ID | Requirement ID | Title | Pre-conditions | Steps | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-SAM-01 | IT-F-005 | Create license pool with encrypted key | Logged in as IT Admin | 1. POST `/api/v1/licenses` with 10 seats and a key. 2. Inspect stored record. 3. Send 0, 2.5 and "abc" seats and reversed dates. | 1. 201, 10 available, key masked, no key fields returned. 2. Ciphertext `v1:...`, no plaintext. 3. 400 each. | `tests/licenses.test.js` | Pass |
| TC-SAM-02 | IT-F-006 | Allocate, prevent over-allocation, reclaim | License with 2 seats; 3 assets | 1. Allocate to asset 1, repeat. 2. Allocate to asset 2 and 3. 3. Reclaim asset 1, allocate asset 3. 4. 10 concurrent requests for 3 seats. 5. Allocate an expired license. | 1. 201, then 409. 2. 201, then 409 "No available seats". 3. Seat reused. 4. Exactly 3 succeed, 7 get 409. 5. 409. | `tests/licenses.test.js` | Pass |
| TC-SAM-03 | IT-F-007 | Ingest manifest and reconcile | Asset with MAC, license allocated | 1. Agent posts manifest with duplicate entries. 2. Reconcile; read the reconciliation status as Auditor. 3. Unknown device. 4. Missing and wrong agent key. | 1. 200, matched by MAC, 2 programs. 2. Installed 1, allocated 1, unlicensed program listed; the status read adds no audit entries. 3. 404. 4. 401. | `tests/compliance.test.js` | Pass |
| TC-SAM-04 | IT-F-008 | Detect blacklisted software | Default blacklist | 1. Manifest with Chrome, `BitTorrent.exe`, XMRig. 2. Repeat BitTorrent. 3. Blacklist TeamViewer and report it. 4. Resolve an incident. | 1. Two HIGH incidents and notifications. 2. No duplicate. 3. One new incident. 4. Status `RESOLVED`. | `tests/compliance.test.js` | Pass |

### Suite 3: Procurement

| Test Case ID | Requirement ID | Title | Pre-conditions | Steps | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-PROC-01 | IT-F-009 | Submit requisition | Logged in as Employee | 1. Submit 2 monitors at 450. 2. Read as owner and as another employee. 3. Submit invalid variants. 4. Submit as Auditor. | 1. 201, `PR-YYYY-NNNN`, `PENDING_MANAGER_APPROVAL`, total 900. 2. 200 and 403. 3. 400 each. 4. 403. | `tests/procurement.test.js` | Pass |
| TC-PROC-02 | IT-F-010 | Three-tier approval, rejection, separation of duties | Pending requisition | 1. Finance approves first; issue PO early. 2. Manager, Director, Finance approve in order. 3. Manager approves own request. 4. Director rejects without and with reason. | 1. 403 and 409. 2. States advance to `APPROVED` with 3 approvals. 3. 403. 4. 400, then `REJECTED`; later approval 409. | `tests/procurement.test.js` | Pass |
| TC-PROC-03 | IT-F-011 | Issue PO and onboard delivery | Fully approved requisitions (hardware and software) | 1. Finance issues PO, then a second. 2. Deliver with wrong serial count, then 2 serials. 3. Software delivery with key. | 1. 201 `PO-YYYY-NNNN`, then 409. 2. 400, then 2 `AVAILABLE` assets linked to the PO; requisition `DELIVERED`. 3. License pool with 5 seats and masked key. | `tests/procurement.test.js` | Pass |

### Suite 4: Alerts, reports and maintenance

| Test Case ID | Requirement ID | Title | Pre-conditions | Steps | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-AUD-01 | IT-F-012 | Under-licensing breach alert | License with 2 seats | 1. Three agents report the software. 2. List breach notifications. 3. Reconcile again. | 1. Breach reported, compliance below 100%. 2. One HIGH notification, deficit 1, audit entry. 3. No new notification. | `tests/compliance.test.js` | Pass |
| TC-AUD-02 | IT-F-013 | Expiry alerts at 60, 30 and 7 days | License and warranty expiring 31-12-2026 | Run the check as of 01-09, 01-11, 05-11, 05-12, 26-12-2026 and 02-01-2027. | Nothing; two LOW (60); nothing; two MEDIUM (30); two HIGH (7); two EXPIRED. | `tests/alerts-reports.test.js` | Pass |
| TC-AUD-03 | IT-F-014 | Compliance report JSON and CSV | One seat, two installs, one blacklisted program | 1. GET JSON report. 2. Recompute hash. 3. GET CSV. 4. License named `=HYPERLINK(...)`. 5. Employee requests report. | 1. Deficit 1, 1 unallocated install, 1 incident, audit chain valid. 2. Matches `contentSha256`. 3. Attachment with hash header and correct row. 4. Cell prefixed with `'`. 5. 403. | `tests/alerts-reports.test.js` | Pass |
| TC-MAINT-01 | IT-F-015 | Maintenance logging | Available asset | 1. Log an upgrade. 2. Out-of-service repair while checked out. 3. Check in, log repair, try check-out. 4. Complete with extra cost. | 1. 201 `COMPLETED`. 2. 409. 3. `UNDER_REPAIR`, check-out 409. 4. Cost 150, asset `AVAILABLE`, total 235.50. | `tests/maintenance.test.js` | Pass |
| TC-MAINT-02 | IT-F-016 | Decommission with certificate and seat reclaim | Asset holding 2 license seats | 1. Decommission while checked out. 2. Without certificate; as Technician. 3. Decommission correctly. 4. Check-out, check-in, allocate, telemetry afterwards. | 1. 409. 2. 400; 403. 3. `DECOMMISSIONED`, certificate stored, 2 seats reclaimed. 4. 409 each. | `tests/maintenance.test.js` | Pass |

### Suite 5: Non-functional requirements

| Test Case ID | Requirement ID | Title | Pre-conditions | Steps | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-PERF-01 | IT-NF-001 | p95 latency under 50 concurrent clients | 500 seeded assets | 50 clients each send 20 requests (50% reads, 20% searches, 30% creates). | 1,000 responses, no errors, p95 at most 300 ms (values logged). | `tests/performance.test.js` | Pass |
| TC-REL-01 | IT-NF-002 | Health probes, fault isolation, graceful shutdown | Server running | 1. Call both probes. 2. Trigger a handler fault. 3. Stop during an in-flight request. 4. Start `src/index.js` as a process and send SIGTERM. | 1. 200 in under 100 ms. 2. 500 without internals; server keeps serving. 3. Request completes. 4. Exit code 0 within 5 s; data file written. | `tests/reliability.test.js` | Pass |
| TC-SCALE-01 | IT-NF-003 | 50,000 assets and 100,000 seats | Seeded data set | Tag and ID lookup, filtered search, license list, compliance report. | Lookups under 100 ms, search under 1 s, report under 5 s, seat total 100,000 (values logged). | `tests/scalability.test.js` | Pass |
| TC-AUDIT-01 | IT-NF-004 | Hash-chained audit trail | Data file on disk | 1. Perform actions; read trail and verify. 2. PUT, PATCH, DELETE on the audit endpoint. 3. Mutate an in-memory entry. 4. Edit, edit-and-re-hash, and delete stored entries; verify each. | 1. Entries with actor, role, IP; chain valid. 2. 405. 3. TypeError (frozen). 4. Invalid each time, broken entry identified. | `tests/audit.test.js` | Pass |
| TC-UX-01 | IT-NF-005 | Automated WCAG 2.1 AA checks | Dashboard files | Check language, labels, skip link, landmarks, live region, tables, headings, inline code, text-token contrast (4.5:1) including tinted status pills, graphic-mark contrast (3:1), identical OS-dark and toggle-dark tokens, focus style; fetch the page and its assets. | All checks pass; page served with CSP. | `tests/accessibility.test.js` | Pass |
| TC-DR-01 | IT-NF-006 | Crash recovery and encrypted backup restore | Data file and backup directory | 1. Write data, crash without flushing, restart. 2. Back up, delete data file, restore, restart. 3. Tampered backup and wrong key. | 1. Data present (RPO). 2. Data, encrypted key and audit chain intact; time logged (RTO). 3. Both refused. | `tests/reliability.test.js` | Pass |

### Suite 6: Security

| Test Case ID | Requirement ID | Title | Pre-conditions | Steps | Expected result | Automated test | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-SEC-01 | PRJ-SR-001 | TLS 1.3 only, HSTS, HTTP redirect | Self-signed certificate generated with `openssl` | 1. TLS 1.3 client. 2. Client limited to TLS 1.2. 3. Plain HTTP to the redirect port. | 1. 200 over TLSv1.3 with HSTS. 2. Handshake refused. 3. 301 to the HTTPS URL. | `tests/security.test.js` | Pass |
| TC-SEC-02 | PRJ-SR-002 | JWT validation and RBAC | Employee token | Send no token, tampered payload, `alg=none`, expired and foreign-key tokens; employee calls admin and asset endpoints; disable the account. | 401 for each bad token; 403 for wrong role; 15-minute expiry; disabled account 401 at once. | `tests/security.test.js` | Pass |
| TC-SEC-03 | PRJ-SR-003 | Key masking, encryption and controlled reveal | License with key | Read as Technician and Auditor, Employee; reveal as IT Admin and Super Admin; check audit and store; tamper with ciphertext. | Masked only; 403 for Employee and IT Admin; Super Admin sees key, reveal audited; no plaintext stored; tampering detected. | `tests/security.test.js` | Pass |
| TC-SEC-04 | PRJ-SR-004 | Input validation and hardening headers | IT Admin token | Unknown field, `__proto__`, markup tag, XSS text, injection search, text/plain, malformed JSON, 200 KB body, traversal paths, dashboard source scan. | 400, 400, 400, stored as JSON with CSP/nosniff/DENY, literal match, 415, 400, 413, 404, no HTML-injection APIs. | `tests/security.test.js` | Pass |
| TC-SEC-05 | PRJ-SR-005 | Brute-force lockout and rate limiting | Controllable clock | 5 wrong passwords, 6th, correct password, other account, advance 15 min; API limit of 5 per minute. | 401 x5, 429 with Retry-After, 429, 200, lockout audited, 200 after expiry; 6th API call 429. | `tests/security.test.js` | Pass |

---

## 14. Test Metrics & Reporting

**Metrics collected**

- Test cases executed / planned (target 100%).
- Test cases passed / executed (target 100%).
- Requirement coverage: requirements with at least one passing test case / total requirements (target 100%, enforced by `scripts/check-docs.js`).
- Line coverage from `npm run coverage` (reported for information).
- Performance figures (p50, p95, p99, throughput) and scalability timings from test diagnostics.
- Defect density and defect ageing from GitHub Issues.

**Reports**

- Every CI run: per-Node-version TAP results and coverage output as artifacts, and a summary table in the GitHub Actions job summary generated from the real results.
- Final Test Summary Report at the end of UAT.

**Execution record (22-10-2026, local):** all 27 test cases (34 automated tests, including the demo-data test) passed on Node.js 18, 20 and 22; lint, SAST, dependency audit and documentation integrity checks passed; the build and the staging smoke test passed against the packaged build.

---

## 15. Approvals

| Role | Name | Signature / Date |
| :--- | :--- | :--- |
| QA Lead | | |
| Dev Lead | Dilipan Y | |
| Product Owner | | |
