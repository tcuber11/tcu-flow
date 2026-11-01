# TCuFlow Documentation Pack

**Product:** TCuFlow  
**Tagline:** One Workspace. Multiple Devices. Zero Friction.  
**Version:** 1.0  
**Status:** Baseline specification for discovery and MVP planning  
**Date:** 2 November 2026

## Document index

| ID | Document | Purpose |
|---|---|---|
| 01 | [PRD](01-PRD.md) | Product goals, users, scope, requirements and acceptance criteria |
| 02 | [TRD](02-TRD.md) | Technical architecture, platform integrations, protocol, security and operations |
| 03 | [AFD](03-AFD.md) | User journeys, screen flows, state transitions and interaction rules |
| 04 | [DBD](04-DBD.md) | Visual identity, design system, screens and interaction design |
| 05 | [BSD](05-BSD.md) | Local data model, SQLite schema, persistence and migrations |
| 06 | [IPD](06-IPD.md) | Implementation phases, work breakdown, testing and release plan |

## Supporting diagrams

- `diagrams/system-architecture.mmd`
- `diagrams/app-flow.mmd`
- `diagrams/session-sequence.mmd`
- `diagrams/erd.mmd`

## Product summary

TCuFlow is a native desktop application that connects a macOS computer (initially the controller) with a Windows computer (initially the agent) over a trusted local network. The intended experience is similar to using one keyboard and pointing device across two computers: the pointer crosses a configured screen edge, keyboard and pointer input are routed to the active computer, text clipboard can be shared, and files can be transferred in either direction.

The MVP is LAN-only and does not require a cloud service. It is not a remote desktop or screen-streaming product.

## Important baseline decisions

1. **Initial topology:** one macOS controller and one Windows agent. Design protocol and data structures so multi-device support can be added later, but do not implement it in MVP.
2. **Native applications:** Swift/SwiftUI for macOS; C#/.NET for Windows. Use native OS APIs for input, clipboard, permissions and packaging.
3. **Local-first:** no mandatory account, cloud relay, telemetry service or internet dependency.
4. **Transport:** authenticated TLS over TCP for reliable control and file transfer. Discovery is separate from authentication.
5. **Security-first:** pairing approval, per-device identity, encrypted sessions, explicit clipboard sharing, visible active-control state and emergency local recovery.
6. **MVP clipboard:** plain text only. Images, rich text and file clipboard formats are out of scope.
7. **MVP file transfer:** explicit file selection and receive destination. Finder-to-Explorer native drag-and-drop is not an MVP blocker.
8. **Platform constraints:** macOS permissions and Windows secure desktop/UAC restrictions must be documented and handled honestly. Do not claim universal input control.
9. **No silent input capture:** only capture and forward input while the user has explicitly enabled a trusted active session. Do not record or log typed content.
10. **No invented implementation:** every feature must be tested on real macOS and Windows hardware before being marked complete.

## How Claude Code should use this pack

Read all six documents before coding. Treat them as a coordinated baseline. If requirements conflict, stop and report the conflict rather than silently choosing. Before changing a decision, document:
- the original requirement,
- the proposed change,
- technical and UX impact,
- security/privacy impact,
- migration impact (if any),
- tests needed,
- approval required.

Start with the discovery and Phase 0/Phase 1 activities in `06-IPD.md`. Do not attempt to implement all phases in one pass.
