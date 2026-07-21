# Release candidate test report — 0.4.69

**Build:** Moodle Course Review 0.4.69  
**Commit:** `e3514f7d111d4ef3b1219a22a1a2395d9c565efe`  
**Checked:** 21 July 2026 (Pacific/Auckland)

## Automated release gate

| Area | Command | Result |
| --- | --- | --- |
| Extension static checks | `npm run typecheck` | Pass |
| Extension unit/integration tests | `npm test` | Pass — 385 tests |
| Browser functional flows | `npm run test:e2e` | Pass — 7 Playwright flows |
| Server/API tests | `python3 -m pytest -q` in `server` | Pass — 170 tests |
| Deployment/package tests | `python3 -m pytest tests -q` | Pass — 40 tests |
| Pilot service health | `curl -fsS https://fld-mini.tail4ccaba.ts.net/health` | Pass — `{"status":"ok"}` |

The browser-flow suite verifies real extension flows in controlled browser fixtures: highlight and pin creation/recovery, role visibility, selective sharing, accessible/inaccessible frames, nested SCORM single-toolbar coordination, SCORM selection/marker/navigation/recovery, mobile/zoom layout, and equal-height controls.

## Known boundary of automation

Automated tests do not substitute for a signed-in pilot on the live UC Online site. They cannot fully prove browser permissions, live Rise package timing, a real Moodle session, email/role onboarding, or human usability. Those checks are deliberately covered by the manual plan:

- [Manual pilot test plan](manual-pilot-test-plan.md)

## Release-candidate decision

The automated gate is **green**. Version 0.4.69 is suitable for structured manual pilot testing. Treat any data-loss, access-control, SCORM duplication, or comment-navigation fault found in that pilot as a release blocker.
