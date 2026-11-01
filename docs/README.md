# TCuFlow Documentation Pack

**Product:** TCuFlow  
**Tagline:** One Workspace. Multiple Devices. Zero Friction.  
**Version:** 2.0  
**Status:** Updated for the LOKA-based implementation ([ADR-001](adr/ADR-001-fork-loka.md))  
**Date:** 2 November 2026

## Document index

| ID | Document | Purpose |
|---|---|---|
| 01 | [PRD](01-PRD.md) | Product goals, users, scope, requirements and acceptance criteria |
| 02 | [TRD](02-TRD.md) | Technical architecture, platform integrations, protocol, security and operations |
| 03 | [AFD](03-AFD.md) | User journeys, screen flows, state transitions and interaction rules |
| 04 | [DBD](04-DBD.md) | Design intent and decisions (tokens live in [DESIGN.md](../DESIGN.md)) |
| 05 | [BSD](05-BSD.md) | Local state on disk: settings.json, identity, logs |
| 06 | [IPD](06-IPD.md) | Implementation phases, work breakdown, testing and release plan |

## Supporting diagrams

- `diagrams/system-architecture.mmd`
- `diagrams/app-flow.mmd`
- `diagrams/session-sequence.mmd`
- `diagrams/erd.mmd` (settings model)

## Product summary

TCuFlow lets one keyboard and mouse drive a Mac and a Windows PC on the same LAN: the cursor crosses a glowing screen edge onto the other computer, the clipboard (text, pictures, copied files) follows it, and files can be dropped or dragged across. No cloud, no account. It is a fork of LOKA by Aufa Nirsad (Apache-2.0).

## Current decisions

1. **Stack:** Tauri 2 (Rust + React/TypeScript), one app for macOS and Windows (ADR-001; replaces the native Swift/C# plan).
2. **Topology:** peer-to-peer; any linked computer can drive the other.
3. **Transport:** QUIC over TLS 1.3 with pinned per-device certificates, ALPN `tcuflow/1`, ports UDP 53418–53421.
4. **Pairing:** six-digit commit–reveal code shown on both screens; accept on the other computer.
5. **Clipboard:** text, pictures and copied files (owner decision).
6. **Not offered:** remote terminal, folder-as-drive, sound, microphone, notification sharing.
7. **Design:** system-settings look, light and dark ([DESIGN.md](../DESIGN.md)).
8. **Known gaps:** private key not in Keychain/DPAPI, no SHA-256 file verification, unauthenticated UDP glow telemetry, no clipboard toggle (see TRD §11).

## How Claude Code should use this pack

Read all six documents before coding. Treat them as a coordinated baseline. If requirements conflict, stop and report the conflict rather than silently choosing. Before changing a decision, document:
- the original requirement,
- the proposed change,
- technical and UX impact,
- security/privacy impact,
- migration impact (if any),
- tests needed,
- approval required.

Start from section 4 ("Next work") in `06-IPD.md`. Do not claim any input, clipboard or transfer behaviour works until it has been verified on real hardware.
