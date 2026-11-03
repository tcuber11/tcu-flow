# 02 — Technical Requirements Document (TRD)

**Product:** TCuFlow
**Version:** 2.0
**Status:** As built on the LOKA fork (see [ADR-001](adr/ADR-001-fork-loka.md))
**Date:** 2 November 2026

## 1. Purpose

This document describes TCuFlow's technical architecture as implemented, the platform constraints it lives with, and the gaps between the implementation and the security/reliability requirements in the PRD. Version 1.0 proposed native Swift + C# applications; ADR-001 replaced that with a fork of LOKA (Tauri 2, Rust, React).

## 2. Architecture principles

1. One codebase for macOS and Windows; OS-specific code behind `platform/` modules.
2. Local-first; no account, relay, telemetry service or internet dependency (the in-app updater is the only outbound call, and only when the user opens About or a release is found).
3. Every device is identified by its own TLS certificate; discovery never implies trust.
4. Input, clipboard and files travel over pinned, encrypted connections.
5. Fail safe: losing the link returns the cursor home and releases held keys.
6. Nothing is shared or started with the computer until the user turns it on.

## 3. System context

- **Peers, not controller/agent.** Every TCuFlow install can drive any paired device and be driven by it. The PRD's "Mac controller, Windows agent" is one configuration of this.
- **LAN:** multicast discovery plus manual IP; QUIC connections between paired devices.
- **Local state:** `settings.json` and the identity certificate/key in the app data directory (`dev.tcuflow.app`).

## 4. Technology stack

| Area | Implementation |
|---|---|
| App shell | Tauri 2 (`src-tauri/`), one window plus transparent overlay windows for the edge glow |
| Backend | Rust (tokio) |
| UI | React 19 + TypeScript + Tailwind 4 (`src/`), light/dark themes |
| Transport | QUIC (quinn) over TLS 1.3 (rustls, ring), ALPN `tcuflow/1` |
| Identity | Self-signed certificate per device (rcgen); SHA-256 fingerprint = device identity |
| Discovery | JSON announce on IPv4 multicast (LocalSend-style), unicast to hand-added hosts |
| Input capture/injection, macOS | Core Graphics event tap and event posting (needs Accessibility) |
| Input capture/injection, Windows | Low-level hooks and `SendInput` in the interactive user session |
| Clipboard | arboard (text, images) plus native file-list clipboard per OS |
| Updates | tauri-plugin-updater; `latest.json` on GitHub releases, minisign-signed |
| Packaging | macOS `.app`/`.dmg`; Windows NSIS `-setup.exe` (and `.msi`) |

## 5. Code map

| Module | Responsibility |
|---|---|
| `src-tauri/src/lib.rs` | App wiring, Tauri commands, tray, service gate (`allow_service`) |
| `kvm.rs` | Shared mouse/keyboard sessions, 9-byte input frames, pairing frames, return shortcut |
| `clip.rs` | Clipboard pictures and files; text rides in the KVM session |
| `carry.rs` | File drags carried across the edge |
| `network/secure.rs` | Identity, pinned QUIC/TLS endpoint, pairing code |
| `network/discovery.rs` | Multicast announce/answer, manual hosts |
| `network/transfer.rs` | Files, pictures, clipboard file batches |
| `network/telemetry.rs` | 60 Hz edge-proximity packets for the glow |
| `platform/{macos,windows,linux,android}.rs` | Cursor, hooks, injection, screens per OS. iOS has no injection: it uses the generic `TouchEngine` (touchpad only) |
| `settings.rs` | Persistent state (`settings.json`) |
| `journal.rs` | Rotating log `logs/tcuflow.log` |
| `screen.rs` | Remote screen: capture (SCK / Windows Graphics Capture), JPEG encode, viewer input injection, viewer window commands |
| `update.rs` | In-app update check and install |
| `src/` | UI: device list and pairing (`Home.tsx`, `Pairing.tsx`), edge placement (`Calibrate.tsx`), pointer settings, transfers, clipboard history |

## 6. Network design

### Ports

| Port | Protocol | Use |
|---|---|---|
| 53418 | UDP | Discovery announce/answer (multicast + unicast) |
| 53419 | UDP | Edge-proximity telemetry for the glow (HMAC-signed, key per run handed over `Service::Glow`) |
| 53420 | QUIC (UDP) | Transfers: files, pictures, clipboard files |
| 53421 | QUIC (UDP) | KVM sessions, pairing, services |

Ports and ALPN differ from LOKA's on purpose, so TCuFlow and LOKA never pair with or block each other.

### Discovery

- Each device announces `{alias, deviceType, os, fingerprint, proto, aspectRatio, controllable, text}` as JSON.
- Announcements carry no secrets and grant no trust.
- "Add by IP" stores hosts in settings and announces to them by unicast, for networks that drop multicast.

### Transport and identity

- One QUIC connection per peer address; every channel is a stream on it.
- Each device generates a self-signed certificate on first run; its SHA-256 fingerprint is its identity.
- Both sides present certificates; a connection is accepted only when the peer's fingerprint is paired (pairing streams excepted).
- An address is never identity: a device that takes a paired device's IP but not its key is refused.

### Pairing

1. The requester commits to a 32-byte nonce (sends its hash), then both sides exchange nonces.
2. Both screens show a 6-digit code derived from both fingerprints and both nonces.
3. The answering user accepts only if the codes match; the requester cannot try certificates until the codes collide, because it committed first.
4. On accept, both sides store the other's fingerprint and alias.

### Wire protocol

- KVM: fixed 9-byte little-endian frames `tag | 8-byte payload`; text clipboard and typed text follow as UTF-8.
- Transfer: `u32 header_len | JSON header | bytes`, one QUIC stream per payload.
- Protocol version `kvm::PROTOCOL` (currently 2) is announced; devices on another version show "Needs update".

## 7. Input control

- Each paired device can have a portal: a stretch of one monitor edge (`edge`, `start`, `end`).
- Pushing the cursor into the portal hands input to that device; leaving that device through the opposite edge, **Ctrl+Alt+Esc**, or a double tap of **Ctrl** returns it.
- While driving, the local cursor is hidden and parked; Ctrl and ⌘ can be swapped so shortcuts keep working.
- Link loss: the driven side releases every held key/button and the cursor comes home within about 3 seconds.
- Scroll Lock (F14 on Mac) locks the pointer to the current screen.

### macOS constraints

- Requires **Accessibility** (and Local Network on macOS 15+). macOS may require re-granting after an app update.
- Event taps can be disabled by the OS on timeout; control returns home.
- No control of the login window or secure input fields.

### Windows constraints

- Runs in the interactive user session; `SendInput` cannot reach the UAC secure desktop, lock screen, or elevated windows unless TCuFlow itself runs elevated.
- Windows Firewall must allow TCuFlow on the Private network profile.

## 8. Clipboard

- Text, pictures and copied files travel both ways when the cursor crosses.
- Limits: text 1 MiB, pictures 10 MB (PNG), files 1 GiB total per clipboard.
- Clipboard items a password manager marks as secret are not sent.
- An unchanged clipboard is not resent, and what just arrived is never sent back (no echo loop).
- Recent clipboard keeps the last 12 entries in memory for re-copying; nothing is written to disk or logs.

## 9. File transfer

- Ways to send: drop on the glowing edge, drag across the edge, Explorer **Send to → TCuFlow**, Finder **Open With → TCuFlow**, or **Send files…** on a device.
- Files land in `Downloads/TCuFlow` (or the user's chosen folder); folder structure is kept; names that would climb out of the folder are rejected; existing files are never overwritten (`name (2).ext`).
- Progress, speed, cancel, and open-folder on both sides.
- Integrity on the wire comes from the authenticated QUIC/TLS stream; each file also ends with a 32-byte SHA-256 of its bytes (`Header.sha256`), hashed while reading on both ends, so damage between the two disks is caught and the partial copy deleted.

## 10. Services

LOKA's remote terminal, folder-as-drive, sound, microphone and notification sharing are refused in `allow_service` and hidden in the UI. The code remains in `shell.rs`, `share.rs`, `audio.rs`, `notify.rs` and is unreachable from a peer.

TCuFlow adds one service of its own: **Screen** (`screen.rs`, [ADR-002](adr/ADR-002-remote-screen.md)). When its user turns on *Share my screen*, a linked computer can open this one's primary display in a window and drive it: JPEG frames at up to 20 fps, ≤1600 px wide, over the KVM endpoint; the viewer's mouse, wheel, keys (set-1 scancodes) and text are injected through `platform::Injected`. macOS needs Screen Recording permission; Windows uses Graphics Capture (secure desktop never captured). Slice 2 replaces JPEG with hardware H.264.

## 11. Security controls and known gaps

| Requirement (PRD §8) | Status |
|---|---|
| TLS 1.3, peer authentication, discovery ≠ trust | Met (pinned certificates, ALPN `tcuflow/1`) |
| Pairing approval with a code on both screens | Met (commit–reveal 6-digit code) |
| No typed content, clipboard or file content in logs | Met by design; to be re-verified in review |
| Visible remote-control state and emergency return | Met (status toast, Ctrl+Alt+Esc, double Ctrl) |
| Private keys in Keychain / DPAPI | Done: `network::secure::keystore` — macOS login keychain (generic password per data dir), Windows DPAPI user scope (`identity.key.dpapi`), Linux/mobile owner-only `identity.key` (0600). Plain `identity.key` from earlier versions is moved in and deleted |
| SHA-256 verification of received files (FR-017) | Done: trailer after the bytes, checked by the receiver |
| Every channel authenticated | Done: telemetry datagrams carry an HMAC-SHA256 tag and a counter under a per-run key each sender hands to each paired device over the authenticated link (`kvm::Service::Glow`, protocol 3); unknown senders and replays are dropped. The position itself is not secret, so it stays plaintext |
| Updates signed | Met: minisign key generated for TCuFlow; private key kept outside the repo |

## 12. Observability

- `logs/tcuflow.log` in the app data directory, rotated at 1 MiB; its tail is included in **About → Diagnostics**.
- Logs record lifecycle, state changes and errors; never keystrokes, clipboard or file contents.

## 13. Testing

- `cargo test` (53 tests): pairing code, identity persistence, transfers, clipboard batches, settings, path safety. One transfer test is occasionally flaky under parallel load.
- `npm run build`: TypeScript typecheck and bundle.
- CI on Windows runners for every push; the **Build Windows installer** workflow produces the NSIS installer as an artifact.
- Real-hardware verification of input, clipboard and transfers between a Mac and a Windows PC is still pending.

## 14. Packaging and updates

- macOS: universal `.app`/`.dmg`; not notarized yet (Apple Development identity only).
- Windows: NSIS installer from GitHub Actions; unsigned, so SmartScreen warns.
- Updates: `latest.json` on this repository's releases, signed with `~/.tauri/tcuflow.key` (`scripts/release.mjs`). The repository is private, so in-app update checks cannot read releases until releases are published somewhere readable.
