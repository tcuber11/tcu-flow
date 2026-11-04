# TCuFlow

**One Workspace. Multiple Devices. Zero Friction.**

One mouse and keyboard for a Mac and a Windows PC on the same desk: push the cursor through a glowing screen edge and it lands on the other computer. Plain-text and file clipboard follow the cursor, and files can be sent either way. LAN only, no account, no cloud.

> **Based on [LOKA](https://github.com/fanrsd/LOKA) by Aufa Nirsad** (Apache-2.0), imported at upstream 0.9.5 (`8403987`). See [NOTICE](NOTICE) for what TCuFlow changed.

## Install

Download from the [site](https://tcuber11.github.io/tcu-flow/) or the [latest release](https://github.com/tcuber11/tcu-flow/releases/latest): macOS (universal dmg, signed and notarized), Windows (x64 and ARM64), Linux (deb, rpm, AppImage), Android (APK). Installed apps update themselves.

From the command line, with this repository as the tap or bucket:

```bash
# macOS, Homebrew (brew trust: Homebrew 7 and later)
brew tap tcuber11/tcuflow https://github.com/tcuber11/tcu-flow
brew trust --tap tcuber11/tcuflow
brew install --cask tcuflow

# Windows, Scoop
scoop bucket add tcuflow https://github.com/tcuber11/tcu-flow
scoop install tcuflow
```

`scripts/release.mjs` points `Casks/tcuflow.rb` and `bucket/tcuflow.json` at each new release.

### Verify a download

Each release carries `SHA256SUMS`, signed with the TCuFlow release key (`78D3 E7DD EE9D 7980 DACB  FF13 AED8 0678 CD66 0CA6`, on the site as [tcuflow-release-key.asc](https://tcuber11.github.io/tcu-flow/tcuflow-release-key.asc)):

```bash
curl -LO https://tcuber11.github.io/tcu-flow/tcuflow-release-key.asc && gpg --import tcuflow-release-key.asc
gpg --verify SHA256SUMS.asc SHA256SUMS                 # "Good signature from TCuFlow releases"
sha256sum --ignore-missing -c SHA256SUMS               # macOS: shasum -a 256 --ignore-missing -c SHA256SUMS
```

## Status

| Platform | Status |
|---|---|
| Windows 10/11 | x64 and ARM64 installers from CI (`build.yml`), not code-signed yet (SmartScreen asks once); not yet verified on real hardware |
| macOS | Universal dmg from CI, Developer ID signed and notarized; needs the **Accessibility** permission (and **Screen Recording** to share its screen). Verified on macOS 27: install, in-app update, permissions, screen capture |
| Linux (x86-64) | deb / rpm / AppImage from CI; X11 or XWayland; `tcuflow --allow-input` once to be controlled. Inherited code, untested |
| Android 10+ | Signed APK from CI (`scripts/android-keystore.md`): touchpad, clipboard, files; being controlled needs the one-time Wireless-debugging setup in the app. Inherited code, untested |
| iOS / iPadOS | Project in `src-tauri/gen/apple`: touchpad, clipboard, file sending and viewing a computer's screen (iOS lets no app inject input, so it can't be controlled itself). Built by CI; shipping goes through TestFlight / App Store (`docs/guides/apple-signing.md`, `docs/guides/ios.md`) |

Also shared on request, each off until switched on under **This computer shares** (only with paired computers): a folder (opens as a drive), sound, microphone, notifications, and a terminal (runs commands as you; meant for your own computers only).

## Security

Signing: macOS builds are Developer ID signed and notarized; Windows installers are not code-signed yet (SmartScreen asks once); every release carries a GPG-signed `SHA256SUMS` ([code signing policy](https://tcuber11.github.io/tcu-flow/code-signing.html)). Privacy: [privacy policy](https://tcuber11.github.io/tcu-flow/privacy.html).


- Every link is QUIC over **TLS 1.3**; each device has its own self-signed certificate and is pinned by its SHA-256 fingerprint.
- Pairing shows the same 6-digit code on both screens, derived from both fingerprints and a committed nonce from each side.
- ALPN `tcuflow/1` and its own ports keep TCuFlow from pairing with LOKA.

## Network

UDP 53418 (discovery) and 53419 (signed glow telemetry), UDP/QUIC 53420–53421 (files, input). Both computers must be on the same LAN; use **Add by IP** where discovery is blocked.

## Build from source

Requirements: Node.js 20+, Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev        # run
npm run tauri build      # installers in src-tauri/target/release/bundle
cargo test --manifest-path src-tauri/Cargo.toml
```

In-app updates read `latest.json` from this repository's releases; `scripts/release.mjs` signs it with TCuFlow's own updater key, whose public half is in `src-tauri/tauri.conf.json`. A fork needs its own (`npx tauri signer generate`).

## Documentation

The original specification pack is in [docs/](docs/README.md). [ADR-001](docs/adr/ADR-001-fork-loka.md) records the switch from the native Swift/C# plan to the LOKA (Tauri/Rust) base.

## License

[Apache License 2.0](LICENSE). Keep [NOTICE](NOTICE) and the LOKA credit in forks and redistributions.
