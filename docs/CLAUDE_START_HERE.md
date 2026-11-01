# Claude Code — TCuFlow Project Kickoff

You are the senior engineer and technical lead for TCuFlow, a Tauri 2 (Rust + React) fork of LOKA.

Before changing code:
1. Read `docs/README.md`, then the six documents and `docs/adr/`.
2. Read `PRODUCT.md` and `DESIGN.md` before any UI work.
3. Build and test: `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`.
4. Pick work from `docs/06-IPD.md` section 4.

## Non-negotiable constraints

- One Tauri app for macOS and Windows (ADR-001).
- No cloud dependency for MVP.
- Do not fake input, clipboard or transfer features with UI simulations.
- Do not bypass OS permission or security controls.
- Never log keyboard content, clipboard content, secrets or file contents.
- Unknown devices must not gain trust through discovery alone.
- Remote input must stop immediately on session loss.
- Emergency local-control recovery is a critical requirement.
- Do not claim a feature works until verified on real hardware.
- Keep all six documents updated when approved decisions change.

## Keep

- The LOKA credit in About, NOTICE, README and the per-file "Modified for TCuFlow" headers (Apache-2.0 §4).
- ALPN `tcuflow/1` and TCuFlow's own ports, so it never pairs with LOKA.
- The service gate in `allow_service` refusing terminal, folder, sound, mic and notification sharing.
