# Product Backlog and Sprint Plan

**Project:** IT Infrastructure Management Software  
**Team:** Team 03 (SE Project 2026, Section B)  
**Backlog baselined:** 28-10-2026  
**Tracked in:** [GitHub Issues](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues), [Milestones](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/milestones) and the [Team-03 ITIM Sprint Board](https://github.com/users/gaurav-2030/projects/1) (Story Points, Sprint and Epic fields set on all 30 items)

Every story below maps to a requirement in the [SRS](SRS_IT_Infrastructure_Management.docx) and is verified by a test case in the [Test Plan](Test_Plan_IT_Infrastructure_Management.docx). All 27 SRS requirements (16 functional, 6 non-functional, 5 security) are covered.

---

## 1. Sprint summary

| Sprint | Window | Stories | Story points | Goal |
| :--- | :--- | ---: | ---: | :--- |
| **Sprint 1** | 27 Oct – 31 Oct 2026 | 16 | 74 | Asset and licence core plus the security and audit foundation — a demoable register → assign → licence flow running behind JWT auth on green CI. |
| **Sprint 2** | 2 Nov – 7 Nov 2026 | 14 | 73 | Procurement, compliance and reporting on top of the Sprint-1 core, plus the performance, scale, accessibility and recovery targets — feature-complete and frozen. |

## 2. Capacity per team member

| Team member | SRN | GitHub | Sprint 1 | Sprint 2 | Total |
| :--- | :--- | :--- | ---: | ---: | ---: |
| Gaurav Girish | PES1UG24AM103 | `@gaurav-2030` | 15 | 17 | 32 |
| Dilipan Y | PES1UG24AM092 | `@Dilipan-Y-8488` | 21 | 20 | 41 |
| Sunay R Hegde | PES1UG24AM903 | `@SunayHegde` | 21 | 18 | 39 |
| Dhruv Rajagopalan | PES1UG24AM086 | _handle pending_ | 17 | 18 | 35 |
| **Total** | | | **74** | **73** | **147** |

## 3. Epics

| Epic | Label | Story points |
| :--- | :--- | ---: |
| Hardware Asset Management | `epic: hardware` | 16 |
| Software Licence Management | `epic: licensing` | 26 |
| Procurement Workflow | `epic: procurement` | 16 |
| Compliance, Audit and Alerts | `epic: compliance` | 15 |
| Maintenance and Decommissioning | `epic: maintenance` | 8 |
| Security | `epic: security` | 26 |
| Non-Functional Targets | `epic: nfr` | 31 |
| Engineering Infrastructure | `epic: devops` | 9 |

## 4. Sprint 1 — 27 Oct – 31 Oct 2026

**Sprint goal:** Asset and licence core plus the security and audit foundation — a demoable register → assign → licence flow running behind JWT auth on green CI.

| Issue | Story | Requirement | Epic | SP | Owner | Test |
| :--- | :--- | :--- | :--- | ---: | :--- | :--- |
| [#1](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/1) | **US-01** Register a hardware asset | `IT-F-001` | Hardware Asset Management | 5 | Gaurav Girish | `TC-HAM-01` |
| [#2](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/2) | **US-02** Check an asset out to an employee and back in | `IT-F-002` | Hardware Asset Management | 5 | Gaurav Girish | `TC-HAM-02` |
| [#3](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/3) | **US-03** Generate and scan barcode labels | `IT-F-003` | Hardware Asset Management | 3 | Gaurav Girish | `TC-HAM-03` |
| [#4](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/4) | **US-04** Calculate asset depreciation (SL and WDV) | `IT-F-004` | Hardware Asset Management | 3 | Dhruv Rajagopalan | `TC-HAM-04` |
| [#5](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/5) | **US-05** Maintain software licence pools | `IT-F-005` | Software Licence Management | 5 | Sunay R Hegde | `TC-SAM-01` |
| [#6](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/6) | **US-06** Allocate and reclaim licence seats safely | `IT-F-006` | Software Licence Management | 8 | Sunay R Hegde | `TC-SAM-02` |
| [#7](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/7) | **US-09** Submit a purchase requisition | `IT-F-009` | Procurement Workflow | 3 | Dhruv Rajagopalan | `TC-PROC-01` |
| [#8](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/8) | **US-15** Log maintenance against an asset | `IT-F-015` | Maintenance and Decommissioning | 3 | Dhruv Rajagopalan | `TC-MAINT-01` |
| [#9](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/9) | **US-17** Serve the API over TLS 1.3 only | `PRJ-SR-001` | Security | 3 | Dilipan Y | `TC-SEC-01` |
| [#10](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/10) | **US-18** Authenticate with JWT and enforce RBAC | `PRJ-SR-002` | Security | 8 | Dilipan Y | `TC-SEC-02` |
| [#11](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/11) | **US-19** Encrypt and mask licence product keys | `PRJ-SR-003` | Security | 5 | Dilipan Y | `TC-SEC-03` |
| [#12](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/12) | **US-20** Validate input and send hardening headers | `PRJ-SR-004` | Security | 5 | Dhruv Rajagopalan | `TC-SEC-04` |
| [#13](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/13) | **US-23** Expose health probes and shut down gracefully | `IT-NF-002` | Non-Functional Targets | 3 | Dhruv Rajagopalan | `TC-REL-01` |
| [#14](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/14) | **US-25** Record every change in a hash-chained audit trail | `IT-NF-004` | Non-Functional Targets | 8 | Sunay R Hegde | `TC-AUDIT-01` |
| [#15](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/15) | **US-28** CI/CD pipeline for every push and pull request | — | Engineering Infrastructure | 5 | Dilipan Y | — |
| [#16](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/16) | **US-29** Record the Sprint-1 demo video | — | Engineering Infrastructure | 2 | Gaurav Girish | — |

**Sprint 1 total: 74 story points across 16 stories.**

## 5. Sprint 2 — 2 Nov – 7 Nov 2026

**Sprint goal:** Procurement, compliance and reporting on top of the Sprint-1 core, plus the performance, scale, accessibility and recovery targets — feature-complete and frozen.

| Issue | Story | Requirement | Epic | SP | Owner | Test |
| :--- | :--- | :--- | :--- | ---: | :--- | :--- |
| [#17](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/17) | **US-07** Ingest endpoint manifests and reconcile installs | `IT-F-007` | Software Licence Management | 8 | Sunay R Hegde | `TC-SAM-03` |
| [#18](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/18) | **US-08** Detect blacklisted software | `IT-F-008` | Software Licence Management | 5 | Sunay R Hegde | `TC-SAM-04` |
| [#19](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/19) | **US-10** Route requisitions through a three-tier approval chain | `IT-F-010` | Procurement Workflow | 8 | Dhruv Rajagopalan | `TC-PROC-02` |
| [#20](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/20) | **US-11** Issue purchase orders and onboard deliveries | `IT-F-011` | Procurement Workflow | 5 | Dhruv Rajagopalan | `TC-PROC-03` |
| [#21](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/21) | **US-12** Alert on under-licensing | `IT-F-012` | Compliance, Audit and Alerts | 5 | Gaurav Girish | `TC-AUD-01` |
| [#22](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/22) | **US-13** Raise expiry alerts at 60, 30 and 7 days | `IT-F-013` | Compliance, Audit and Alerts | 5 | Dilipan Y | `TC-AUD-02` |
| [#23](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/23) | **US-14** Generate compliance reports (JSON and CSV) | `IT-F-014` | Compliance, Audit and Alerts | 5 | Sunay R Hegde | `TC-AUD-03` |
| [#24](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/24) | **US-16** Decommission an asset and reclaim its seats | `IT-F-016` | Maintenance and Decommissioning | 5 | Gaurav Girish | `TC-MAINT-02` |
| [#25](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/25) | **US-21** Lock accounts and rate-limit after failed logins | `PRJ-SR-005` | Security | 5 | Dilipan Y | `TC-SEC-05` |
| [#26](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/26) | **US-22** Meet the p95 latency target | `IT-NF-001` | Non-Functional Targets | 5 | Dhruv Rajagopalan | `TC-PERF-01` |
| [#27](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/27) | **US-24** Hold 50k assets and 100k seats within query budgets | `IT-NF-003` | Non-Functional Targets | 5 | Dilipan Y | `TC-SCALE-01` |
| [#28](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/28) | **US-26** Meet WCAG 2.1 AA on the dashboard | `IT-NF-005` | Non-Functional Targets | 5 | Gaurav Girish | `TC-UX-01` |
| [#29](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/29) | **US-27** Recover from crash or data loss within RPO/RTO | `IT-NF-006` | Non-Functional Targets | 5 | Dilipan Y | `TC-DR-01` |
| [#30](https://github.com/SE-Project-2026-B-sec/Team-03---IT-infrastructure-management-software/issues/30) | **US-30** Record the Sprint-2 demo and freeze the documentation | — | Engineering Infrastructure | 2 | Gaurav Girish | — |

**Sprint 2 total: 73 story points across 14 stories.**

## 6. Working agreement

1. No commit goes straight to `main`. Each story is built on a branch named `feature/<issue-number>-<short-slug>`.
2. The assignee raises the pull request and links it to its issue with `Closes #<n>`.
3. A repo owner reviews and merges. The author does not merge their own PR.
4. All five CI/CD stages must be green before a merge is allowed.
5. Story points are set at backlog grooming and are not changed mid-sprint; scope moves instead, so the burndown stays honest.
6. An issue is **Done** only when its acceptance criteria and Definition of Done are all ticked.

## 7. Story-point scale

| Points | Meaning |
| ---: | :--- |
| 2 | Process or documentation task, under half a day |
| 3 | Single well-understood change, about a day |
| 5 | Multi-part feature with edge cases, one to two days |
| 8 | Complex feature: concurrency, workflow state or cryptography, two to three days |

## 8. Jira

The same 30 stories and 8 epics are provided as [`jira-import.csv`](jira-import.csv) for Jira's **Import issues from CSV** wizard (Project settings -> Import). The file carries issue type, summary, description in wiki markup, priority, story points, sprint, assignee, epic link and labels, and each story links back to its GitHub issue.

During the import map the columns as follows, then confirm the sprint and story-point fields exist on the board:

| CSV column | Jira field |
| :--- | :--- |
| Story Points | Story point estimate |
| Sprint | Sprint |
| Epic Link | Parent (or Epic Link on company-managed projects) |
| Assignee | Assignee — match each name to the team member's Atlassian account |

