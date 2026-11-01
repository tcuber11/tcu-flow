# ADR-001 — Build TCuFlow on a fork of LOKA

**Status:** Accepted (owner decision, 2 November 2026)

## Original requirement

TRD §4 and README decision 2: native applications, Swift/SwiftUI on macOS and C#/.NET on Windows, with a shared protocol package.

## Decision

Fork [LOKA](https://github.com/fanrsd/LOKA) 0.9.5 (Apache-2.0, Aufa Nirsad) as the TCuFlow codebase: one Tauri 2 app (Rust backend, React/TypeScript UI) for macOS and Windows.

## Changes made at fork time

- Product, binary (`tcuflow`), identifier (`dev.tcuflow.app`) and release/update links renamed.
- QUIC ALPN `tcuflow/1`; ports UDP 53418 and TCP 53419–53421, so TCuFlow and LOKA never pair or collide.
- Remote terminal, folder-as-drive, sound, microphone and notification sharing refused in `allow_service` (`src-tauri/src/lib.rs`) and hidden in the UI (PRD §6 out of scope: remote shell).
- LICENSE kept; NOTICE extended; changed source files carry a modification header.

## Impact on the specification pack

| Document | Now differs |
|---|---|
| PRD | Clipboard also carries images and copied files (PRD MVP: plain text only); drag-and-drop across the edge exists (PRD: P1); peer-to-peer, either computer can control the other (PRD: Mac controller, Windows agent) |
| TRD | Stack is Tauri/Rust; transport is QUIC over TLS 1.3 (TRD: TCP + TLS 1.3); discovery is a LocalSend-style JSON announce on UDP multicast, not mDNS/DNS-SD |
| BSD | Settings are LOKA's JSON settings file, not the SQLite schema; the private key is a plain file `identity.key` in the app data dir, not Keychain/DPAPI (PRD §8 security requirement) |
| IPD | Repository tree and Phase 1–4 tasks largely done by the import; phases become verification and gap-closing |
| DBD | LOKA's visual design (Oka mascot, glow edge) replaces the DBD token palette until restyled |

## Follow-ups (not done)

1. Decide which PRD rules still apply (rich clipboard, private keys outside Keychain/DPAPI, SQLite) and update the six documents.
2. Generate a TCuFlow updater signing key and replace LOKA's public key in `tauri.conf.json`.
3. Optional: rename internal identifiers (Tauri plugin `loka`, Android package `dev.loka.app`, CSS classes, storage keys).
4. Verify on a real Mac + Windows pair before claiming any feature works.
