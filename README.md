# TCuFlow

**One Workspace. Multiple Devices. Zero Friction.**

One mouse and keyboard for a Mac and a Windows PC on the same desk: push the cursor through a glowing screen edge and it lands on the other computer. Plain-text and file clipboard follow the cursor, and files can be sent either way. LAN only, no account, no cloud.

> **Based on [LOKA](https://github.com/fanrsd/LOKA) by Aufa Nirsad** (Apache-2.0), imported at upstream 0.9.5 (`8403987`). See [NOTICE](NOTICE) for what TCuFlow changed.

## Status

| Platform | Status |
|---|---|
| Windows 10/11 | Inherited from LOKA, not yet verified for TCuFlow |
| macOS | Builds; needs the **Accessibility** permission. Not yet verified on real hardware |
| Linux, Android | Inherited code, not part of the TCuFlow MVP and not tested |

Not offered in TCuFlow (refused by the backend, hidden in the UI): remote terminal, shared folder as a drive, sound, microphone and notification sharing.

## Security

- Every link is QUIC over **TLS 1.3**; each device has its own self-signed certificate and is pinned by its SHA-256 fingerprint.
- Pairing shows the same 6-digit code on both screens, derived from both fingerprints and a committed nonce from each side.
- ALPN `tcuflow/1` and its own ports keep TCuFlow from pairing with LOKA.

## Network

UDP 53418 (discovery), TCP 53419–53421 (telemetry, files, input). Both computers must be on the same LAN; use **Add by IP** where discovery is blocked.

## Build from source

Requirements: Node.js 20+, Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev        # run
npm run tauri build      # installers in src-tauri/target/release/bundle
cargo test --manifest-path src-tauri/Cargo.toml
```

In-app updates read `latest.json` from this repository's releases and still carry LOKA's updater public key. Generate your own key (`npx tauri signer generate`) and put its public key in `src-tauri/tauri.conf.json` before publishing a release.

## Documentation

The original specification pack is in [docs/](docs/README.md). [ADR-001](docs/adr/ADR-001-fork-loka.md) records the switch from the native Swift/C# plan to the LOKA (Tauri/Rust) base.

## License

[Apache License 2.0](LICENSE). Keep [NOTICE](NOTICE) and the LOKA credit in forks and redistributions.
