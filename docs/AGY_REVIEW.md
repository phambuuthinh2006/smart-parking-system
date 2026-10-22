# Independent review by agy — IOT-005

Review date: 2026-10-22. Requested by the user and delivered via Herdr to the existing agy agent in pane `w9:p2`. This document summarizes the response read from that pane and Codex's handling of its findings; it is not a verbatim transcript.

## Initial verdict

**PASS — no Critical/High issues or blockers for this prototype.** Agy inspected backend/frontend/config/docs and independently ran the original 9 PostgreSQL integration tests, 10 Node tests and frontend build successfully.

Reviewed: device key handling; row-lock transaction serialization; after-commit broadcast; timestamp precision/replay handling; client publish restrictions; source isolation; revision ordering; freshness masking; separate project ports/volume; isolated test database; non-root runtime.

## Findings and disposition

| Severity | Finding                                                                                             | Codex response                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Medium   | Expiry and STOMP heartbeat shared one scheduler thread, risking delayed heartbeat under DB blocking | Fixed: separate named scheduler beans for expiry and broker heartbeat                                                    |
| Low      | Comma-separated allowed origins retained whitespace/empty entries                                   | Fixed: shared `AllowedOrigins.parse`; added regression test                                                              |
| Low      | Malformed JSON used Spring's default error shape                                                    | Fixed: handle `HttpMessageNotReadableException`; added HTTP regression test                                              |
| Low      | `AbortSignal.any` compatibility on older mobile browsers                                            | Fixed: per-request AbortController + timeout and unmount cancellation                                                    |
| Info     | Occupancy division lacks a zero-total guard                                                         | No change: this prototype always has exactly four validated spaces; empty snapshots are rejected                         |
| Info     | Extra descending event index duplicates reverse scanning on the primary-key B-tree                  | Deferred: negligible for this small demo; remove in a future migration if needed, without rewriting applied V1 migration |

After fixes: **11/11 Java tests** (10 PostgreSQL integration + one origin-parser unit test), **10/10 Node tests**, frontend build, Docker rebuild/start and browser realtime flow pass. Production-preview test also confirmed backend outage masking, automatic reconnect and persisted history after an outage exceeding 70 seconds.

## Follow-up verdict

Agy completed the focused follow-up review and confirmed **PASS on all four Medium/Low fixes**, with no remaining blocker. Agy also confirmed the handling of the two Info items, independently reran 11 Java tests, 10 Node tests and the frontend production build successfully, and reported IOT-005 ready for completion.

This is prototype acceptance, not verification of physical hardware or all browser/device versions. Chromium and HTTP-emulated sensor traffic were used for the end-to-end checks.
