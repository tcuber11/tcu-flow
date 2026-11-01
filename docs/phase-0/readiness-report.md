# Phase 0 — Implementation-Readiness Report

**Date:** 2 November 2026
**Status:** Superseded by [ADR-001](../adr/ADR-001-fork-loka.md) (fork of LOKA). The native Swift/C# ADR proposals below were not adopted; the environment findings remain accurate.
**Scope:** Environment inventory, document review, platform constraints and proposed ADRs. No application code yet.

## 1. Environment inventory (macOS controller host)

| Item | Found | Notes |
|---|---|---|
| OS | macOS 27.2 (26B123) | Apple M5, arm64 |
| Xcode | 27.2 (27B52) at `/Applications/Xcode.app` | **Blocker:** license not accepted; `xcode-select` points to Command Line Tools |
| Swift | 6.4.2 (CLT) | SwiftPM build works with CLT |
| Signing | 1 "Apple Development" identity | No Developer ID; notarized distribution not possible yet |
| SQLite | 3.54.0 | Partial unique indexes supported |
| .NET SDK | **Not installed** | Windows build cannot be produced on this host |
| Windows hardware / VM | **None found** | VirtualBox installed, no VMs registered; mDNS browse returned no peers |
| GitHub | `gh` logged in as `tcuber11` | Repo `tcuber11/tcu-flow` not created yet |

### Spikes run on this host
- **BSD SQL baseline:** executes cleanly on SQLite 3.54; the partial unique index for "one default layout per pair" works.
- **Network.framework:** a TLS 1.3–only `NWListener` with a `_tcuflow._tcp` Bonjour service builds and initializes.
- **Input permissions:** `AXIsProcessTrusted`, `CGPreflightListenEventAccess` and `CGPreflightPostEventAccess` all return `false` for an unsigned CLI binary — confirms permission onboarding is mandatory and must be tested with a signed app bundle, not a CLI.

## 2. Blockers to finish Phase 0

1. Accept the Xcode license and switch the developer dir (user action, needs sudo):
   `sudo xcodebuild -license accept && sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
2. A real Windows 11 machine (or VM with real interactive session) on the same LAN, with the .NET 10 SDK installed.
3. Without (2), the LAN, TLS interop, `SendInput` and clipboard spikes cannot be validated, and IPD forbids claiming them.

## 3. Document conflicts and gaps

| # | Where | Issue | Proposed resolution |
|---|---|---|---|
| C1 | BSD §4.1 vs §10 | `app_settings` is specified but missing from the SQL baseline | Add it to migration 001 |
| C2 | BSD §4.2/§4.4/§4.5 vs §10 | `idx_devices_last_seen`, `idx_transfers_status` and the default-layout partial unique index are listed but not in SQL | Add them to migration 001 |
| C3 | BSD §4.5 | `transfer_records.status` has no CHECK; uses `awaiting` while AFD says "Awaiting approval" | Add CHECK with the 8 AFD states using snake_case codes |
| C4 | BSD | Local device's own UUID and identity key reference have no defined home | Store `local_device_id` + `local_credential_ref` in `app_settings`; key stays in Keychain/DPAPI |
| C5 | TRD §11 | One linear state chain mixes trust (discovered/paired) with connection (connecting/connected) | Split into a trust state per device and a session state machine; add `revoked` and `error` |
| C6 | PRD §13 vs TRD §6 | "Windows 10/11" is open, but TLS 1.3 is mandatory; Windows 10 SChannel does not support TLS 1.3 in production builds (verify) | Minimum Windows 11 (see ADR-001) |
| C7 | IPD §3 | Windows has `TCuFlow.Agent` and `TCuFlow.UI`, but TRD describes one interactive tray agent | One process for MVP; split only if a later need appears (ADR-004) |
| C8 | IPD §3 | Repo root named `tcuflow/`, actual folder is `tcu-flow/` | Keep `tcu-flow` as repo name; product name stays TCuFlow |
| C9 | TRD §8 | Clipboard on macOS has no change notification; `NSPasteboard.changeCount` must be polled. Newer macOS versions add pasteboard-access privacy prompts (verify on 27.x) | Poll at a low interval only while sharing is on; test the prompt behavior |
| C10 | TRD §7 | Hiding the Mac cursor while control is on Windows needs a consuming event tap (Accessibility), not listen-only (Input Monitoring) | Request Accessibility for the tap; document both permissions in onboarding |

## 4. Platform constraints (summary)

- **macOS:** consuming `CGEventTap` requires Accessibility; macOS disables taps that time out (`kCGEventTapDisabledByTimeout`) — handle by restoring local control first, then re-enabling. Permissions bind to the signed bundle identity, so dev builds need a stable signing identity or permissions reset on every rebuild.
- **Windows:** `SendInput` works only in the interactive user session; UIPI blocks injection into elevated windows unless the agent is elevated or has `uiAccess` (requires signed binary in a secure location) — MVP documents this as restricted. Secure desktop (UAC, lock screen, Ctrl+Alt+Del) is unsupported. Use per-monitor DPI awareness v2 and `MOUSEEVENTF_VIRTUALDESK` absolute coordinates.
- **Discovery:** .NET has no built-in DNS-SD; Windows 10+ exposes `DnsServiceRegister`/`DnsServiceBrowse` (windns.h) via P/Invoke. Windows Defender Firewall prompts on first listen; restrict to the Private profile.

## 5. Critical risks

1. No Windows endpoint → Phases 0–4 cannot be verified (highest).
2. Pairing design is security-critical and must not be custom crypto.
3. Stuck keys/buttons after session loss.
4. Emergency shortcut swallowed by a failing tap.
5. macOS permission churn during development builds.

## 6. Proposed ADRs (status: Proposed — need approval)

| ADR | Decision | Recommended default |
|---|---|---|
| ADR-001 | Minimum OS | macOS 15+, Windows 11 23H2+ (TLS 1.3 in SChannel) |
| ADR-002 | Windows UI framework | WPF on .NET 10 LTS (mature tray support, simpler packaging than WinUI 3) |
| ADR-003 | Pairing | Each device has a self-signed ECDSA P-256 certificate; TLS 1.3 with mutual cert pinning; first contact shows a 6-digit code derived from both certificate fingerprints on both screens (numeric comparison); user confirms on both sides; then fingerprints are stored |
| ADR-004 | Windows process model | Single tray app in the user session, optional "start at login" off by default |
| ADR-005 | Transport | One TLS connection, length-prefixed frames, JSON control messages, binary file chunks, max frame 1 MiB; separate data channel only if measured necessary |
| ADR-006 | Layout | Left/right only in MVP, one display per device |
| ADR-007 | Emergency shortcut | Configurable; default ⌃⌥⌘ Esc, detected inside the tap plus a watchdog that restores local control if the tap is disabled or the session heartbeat misses 3 beats |
| ADR-008 | File receive | Default `~/Downloads/TCuFlow` (Windows: `Downloads\TCuFlow`); ask per transfer; never overwrite without confirmation; partial files deleted on cancel/failure |
| ADR-009 | Clipboard default | Off on every new session; enabled per session by the user |
| ADR-010 | Packaging | macOS: signed .app, notarize when a Developer ID exists; Windows: MSIX after packaging spike |

## 7. Phase 0 remaining tasks

1. User unblocks Xcode (section 2.1).
2. Provision Windows 11 endpoint with .NET 10 SDK.
3. Hello-world builds: SwiftUI menu-bar app (signed) and WPF tray app.
4. LAN spike: Bonjour advertise on Windows, browse from Mac; manual IP fallback.
5. TLS spike: mutual-pinned TLS 1.3 between `Network.framework` and `SslStream`.
6. Permission spike: signed Mac app requests Accessibility/Input Monitoring; Windows `SendInput` moves the cursor in an interactive session.
7. Clipboard spike: read/write plain text on both sides, confirm macOS prompt behavior.
8. Write approved ADRs into `docs/adr/` and update the six documents for C1–C10.

## 8. Proposed repository tree

```text
tcu-flow/
├── apps/
│   ├── macos/TCuFlow/            # SwiftUI app + Swift packages per module
│   └── windows/TCuFlow.Agent/    # WPF tray agent (.NET 10)
├── packages/protocol/
│   ├── schemas/                  # JSON Schema per message type
│   ├── fixtures/                 # golden messages shared by both test suites
│   └── docs/                     # framing, versioning, error codes
├── docs/                         # six documents, diagrams, adr/, phase-0/
├── scripts/
└── tests/                        # cross-platform interop fixtures
```
