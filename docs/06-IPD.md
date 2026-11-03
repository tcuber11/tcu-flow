# 06 — Implementation Plan Document (IPD)

**Product:** TCuFlow
**Version:** 2.0
**Status:** Re-planned after the LOKA fork (see [ADR-001](adr/ADR-001-fork-loka.md))
**Date:** 2 November 2026

## 1. Purpose

Version 1.0 planned a native build from scratch. The LOKA import delivered most of Phases 1–4 at once, so the plan now is: verify on real hardware, close the gaps against the PRD, then release.

## 2. Repository structure

```text
tcu-flow/
├── src/                    # React UI (Home, Pairing, Calibrate, …), theme, icons
├── src-tauri/
│   ├── src/                # Rust backend: kvm, clip, carry, network/, platform/, settings
│   ├── gen/android/        # Android project (dev.tcuflow.app); APK built by build.yml
│   ├── gen/apple/          # iOS/iPadOS Xcode project (touchpad + files only); see docs/guides/ios.md
│   ├── capabilities/
│   └── tauri.conf.json
├── docs/                   # this pack, adr/, phase-0/, diagrams/
├── scripts/release.mjs     # signs installers into latest.json
├── .github/workflows/      # ci.yml (tests on Windows), build-windows.yml (installer artifact)
├── DESIGN.md · PRODUCT.md · NOTICE · LICENSE
└── package.json
```

## 3. Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Discovery, environment, ADRs | Done; ADR-001 replaces the native stack |
| 1 | Pairing, identity, discovery, connection | Implemented (inherited); **verify on real Mac + Windows** |
| 2 | Input sharing, return shortcut, release on loss | Implemented (inherited); **verify on real hardware** |
| 3 | Clipboard | Implemented with text, pictures and files; toggle missing (FR-014) |
| 4 | File transfer | Implemented, with SHA-256 verification (FR-017) |
| 5 | Stabilization and release | Open |

Remote screen (ADR-002): slice 1 implemented (view + control a linked computer's primary display, JPEG); slice 2 (hardware H.264, multi-display, being-viewed indicator) open.

Fork work already done: rebrand and internal renames, protocol/port separation from LOKA, removal of out-of-scope services, opt-in start with computer, TCuFlow updater key, Windows installer workflow, light/dark redesign.

## 4. Next work, in order

1. **Real-hardware verification (blocking):** install on a Mac and a Windows PC on one LAN; run the test matrix in section 6 and record results in `docs/phase-0/` or a new test report.
2. **Security gaps:** none open from TRD §11 (Keychain/DPAPI, SHA-256 on files, signed telemetry: done). Next: the threat model for internet relay if that ever comes.
3. **Clipboard toggle (FR-014):** on/off in the UI, honoured on both sides.
4. **Release pipeline:** macOS build in CI (universal), signing/notarization decision, Windows code signing decision, public release location so in-app updates can read `latest.json`.
5. **Docs and DESIGN.md** kept in step with every change.

## 5. Build and run

```bash
npm install
npm run tauri dev                               # run locally
npm run tauri build                             # installers in src-tauri/target/release/bundle
cargo test --manifest-path src-tauri/Cargo.toml # backend tests
gh workflow run "Build Windows installer"       # Windows installer artifact on GitHub
```

Both computers must run builds from the same protocol version (`kvm::PROTOCOL`).

## 6. Real-hardware test matrix

| Area | Test |
|---|---|
| Discovery | Both appear in Nearby within 10 s; Add by IP works with multicast blocked |
| Pairing | Codes match on both screens; Reject and timeout leave nothing paired; a third device cannot connect |
| Input | Cross Mac→Windows and back on the placed edge; keyboard, click, right-click, scroll, shortcuts with Ctrl/⌘ swap |
| Recovery | Ctrl+Alt+Esc and double Ctrl return; pulling Wi-Fi or sleeping Windows returns the cursor within 3 s with no stuck keys |
| Clipboard | Text, screenshot and copied files both ways; no echo loop |
| Transfer | Drop on edge, drag across edge, Send to; cancel mid-way leaves no partial file; large file (>2 GB) |
| Permissions | macOS Accessibility denied then granted; Windows Firewall prompt and Private profile |
| Restricted | UAC prompt and lock screen are not controllable and the app says so |
| Themes | Light, dark, system switch; both windows follow |

## 7. Definition of done

- Behaviour verified on real hardware for anything touching input, clipboard or transfer.
- `cargo test` and `npm run build` pass; CI green.
- No keystrokes, clipboard or file contents in logs.
- Docs, DESIGN.md and NOTICE updated.

## 8. Risks

| Risk | Mitigation |
|---|---|
| macOS forgets Accessibility after updates | Onboarding in About; troubleshooting step |
| Unsigned installers trigger SmartScreen/Gatekeeper | Document; decide on signing before public release |
| Plain-file private key | Done: Keychain/DPAPI with migration |
| Divergence from upstream LOKA | Keep the import commit; cherry-pick upstream fixes deliberately |
| Flaky transfer test under load | Investigate timing; keep CI rerun policy |
