# 06 — Implementation Plan Document (IPD)

**Product:** TCuFlow  
**Version:** 1.0  
**Status:** Proposed delivery plan

## 1. Purpose

This document turns PRD, TRD, AFD, DBD and BSD into an incremental engineering plan. Work is gated by demonstrated functionality, not by UI completion alone.

## 2. Delivery strategy

- Use one monorepo.
- Build native macOS and Windows applications.
- Keep shared protocol definitions and test fixtures in a dedicated package.
- Develop in small vertical slices.
- Test on real hardware as soon as input integration begins.
- Do not build all features in one Claude Code session.
- Keep documentation synchronized with implementation.

## 3. Repository structure

```text
tcuflow/
├── apps/
│   ├── macos/
│   │   └── TCuFlow/
│   └── windows/
│       ├── TCuFlow.Agent/
│       └── TCuFlow.UI/
├── packages/
│   └── protocol/
│       ├── schemas/
│       ├── fixtures/
│       └── docs/
├── docs/
│   ├── 01-PRD.md
│   ├── 02-TRD.md
│   ├── 03-AFD.md
│   ├── 04-DBD.md
│   ├── 05-BSD.md
│   ├── 06-IPD.md
│   └── diagrams/
├── scripts/
├── tests/
└── README.md
```

## 4. Phase plan

### Phase 0 — Discovery and technical spikes

Tasks:
- Inspect macOS version, Xcode, Swift toolchain and signing setup.
- Inspect Windows version, .NET SDK and packaging environment.
- Confirm both devices can communicate over the intended LAN.
- Spike mDNS discovery.
- Spike TLS peer connection.
- Validate macOS permission requirements for input capture/posting.
- Validate Windows `SendInput` behavior in a normal interactive user session.
- Validate clipboard API behavior.
- Record platform restrictions and architecture decisions as ADRs.

Exit criteria:
- Supported OS baseline proposed and approved.
- Toolchains build hello-world apps on both platforms.
- LAN connection spike works.
- Input permission and injection feasibility is documented.
- No unresolved critical security design blocker.

### Phase 1 — Foundation and pairing

Tasks:
- Create monorepo and CI build checks.
- Create macOS app shell.
- Create Windows agent shell/tray application.
- Implement device identity generation.
- Implement discovery and manual IP fallback.
- Define protocol envelope and version negotiation.
- Implement pairing approval on both endpoints.
- Implement TLS session authentication.
- Implement connection status and heartbeat.
- Implement local persistence and migrations.

Exit criteria:
- Real Mac and Windows devices discover and pair.
- Authenticated encrypted session can be established.
- Unknown peer cannot start a trusted session.
- Revoke/forget device works.
- Connection status is accurate.

### Phase 2 — Input sharing

Tasks:
- Implement platform-neutral input event schema.
- Implement macOS permission onboarding.
- Implement macOS pointer boundary detection.
- Implement display coordinate mapping for one display per device.
- Implement Windows pointer and click injection.
- Implement scroll forwarding.
- Implement keyboard event mapping and forwarding.
- Track remote key/button state.
- Implement release-all and emergency recovery.
- Add visible active-control indicator.
- Test disconnect and sleep/wake behavior.

Exit criteria:
- Pointer crosses configured edge in both directions.
- Keyboard, click and scroll work on the target Windows desktop.
- Emergency shortcut returns local control.
- Network loss does not leave remote keys/buttons stuck.
- No raw input is logged.

### Phase 3 — Clipboard sharing

Tasks:
- Implement plain-text clipboard change detection on both platforms.
- Add origin and sequence metadata.
- Implement echo-loop prevention.
- Add enable/disable settings.
- Add payload size limits and unsupported-format handling.
- Test simultaneous clipboard updates and disconnects.

Exit criteria:
- Copy/paste works in both directions.
- No infinite update loop.
- Disable takes effect immediately.
- Clipboard content is not persisted or logged.

### Phase 4 — File transfer

Tasks:
- Implement native file selection.
- Implement transfer offer/accept/reject.
- Implement bounded chunk streaming.
- Implement progress and speed reporting.
- Implement cancellation.
- Implement temporary-file write and atomic finalization.
- Implement SHA-256 verification.
- Implement overwrite confirmation.
- Add transfer metadata history.
- Add folder transfer and resumability only after the basic file flow is stable.

Exit criteria:
- Files transfer in both directions.
- Integrity is verified.
- Cancellation and failure clean up partial data safely.
- Large files do not cause unbounded memory growth.
- Transfer history contains metadata only.

### Phase 5 — Stabilization and release

Tasks:
- Complete security review and threat-model checklist.
- Test firewall and mDNS behavior.
- Test supported OS versions.
- Test multiple display scaling configurations.
- Test sleep/wake, lock/unlock and user switching.
- Improve diagnostics and redacted support bundle.
- Add startup behavior with explicit user choice.
- Sign/notarize macOS build as applicable.
- Package and sign Windows installer as applicable.
- Write installation and troubleshooting documentation.
- Prepare release notes.

Exit criteria:
- All MVP acceptance criteria pass.
- No unresolved critical/high security findings.
- Installer and upgrade path validated.
- Recovery and permission flows tested on real hardware.

## 5. Work breakdown by area

| Area | Main deliverables |
|---|---|
| Product | Scope, acceptance criteria, open decisions |
| Architecture | ADRs, module boundaries, protocol |
| macOS | UI, permissions, input capture, routing, clipboard, sender |
| Windows | Agent UI, input injection, clipboard, receiver |
| Networking | Discovery, pairing, TLS, session lifecycle |
| Protocol | Schemas, framing, compatibility tests |
| Storage | SQLite, migrations, OS secret-store adapters |
| Design | Wireframes, components, tokens, states |
| QA | Unit, integration, platform, security and performance tests |
| Release | Signing, installers, docs and release checklist |

## 6. Testing strategy

### Unit tests
- Protocol serialization and validation.
- Session state transitions.
- Pointer coordinate normalization.
- Key/button state release logic.
- Clipboard origin/loop prevention.
- File chunk boundaries and checksum calculation.
- Database migrations and repository behavior.

### Integration tests
- Discovery and manual connection.
- Pairing approval/rejection.
- TLS authentication and invalid identity rejection.
- Heartbeat and reconnect.
- Bidirectional clipboard.
- Bidirectional file transfer.
- Cancellation and checksum mismatch.

### Real-device tests
- Mac and Windows on same LAN.
- Wi-Fi and Ethernet where available.
- Different screen resolutions and scaling.
- Permission granted/denied/revoked.
- Sleep/wake and lock/unlock.
- Windows UAC secure desktop limitation.
- Network interruption during remote control.
- Emergency shortcut under active remote control.

### Security tests
- Unknown peer connection.
- Invalid/revoked peer identity.
- Replay and out-of-order messages.
- Oversized and malformed frames.
- Path traversal and malicious file metadata.
- Clipboard payload limits.
- Log redaction.
- Rate limiting and resource exhaustion.

## 7. Definition of Done for every task

A task is done only when:
- Code is implemented in the correct module.
- Relevant tests are added and pass.
- Build succeeds on the target platform.
- Error and permission paths are handled.
- No sensitive content is logged.
- Documentation is updated.
- Known limitations are recorded.
- The feature is verified on real hardware when OS integration is involved.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| macOS event permissions are complex | Validate early in Phase 0; provide guided permission UX |
| Windows secure desktop blocks injection | Explicitly document unsupported surfaces; never bypass OS protections |
| Input gets stuck after disconnect | Central input ownership state machine and release-all recovery |
| Keyboard layouts differ | Platform-neutral key model and test matrix |
| mDNS blocked by network | Manual IP fallback |
| Wi-Fi latency varies | Measure latency; test Ethernet; coalesce pointer movement |
| Clipboard loops | Origin IDs, sequence IDs and fingerprints |
| Large file memory pressure | Bounded streaming and temporary files |
| Claude changes architecture unexpectedly | ADR requirement and documentation review gate |

## 9. Milestones and estimates

Estimates must be revised after Phase 0 because OS integration and permission behavior can materially affect effort.

| Milestone | Scope | Exit evidence |
|---|---|---|
| M0 | Discovery/spikes | Environment report and ADRs |
| M1 | Pairing/connectivity | Real authenticated Mac-Windows session |
| M2 | Input sharing | Demonstrated pointer/keyboard/scroll control |
| M3 | Clipboard | Bidirectional plain-text test |
| M4 | File transfer | Verified bidirectional transfer |
| M5 | MVP release candidate | Full acceptance and security test report |

Do not promise calendar dates until Phase 0 has been completed.

## 10. Release checklist

- [ ] PRD acceptance criteria reviewed.
- [ ] Supported OS versions documented.
- [ ] Pairing and credential lifecycle reviewed.
- [ ] TLS and peer identity verified.
- [ ] Emergency recovery tested.
- [ ] Clipboard privacy behavior tested.
- [ ] File transfer integrity and path validation tested.
- [ ] Logs reviewed for sensitive data.
- [ ] macOS app signed/notarized as applicable.
- [ ] Windows installer signed as applicable.
- [ ] Upgrade and uninstall behavior tested.
- [ ] User guide and troubleshooting guide published.
- [ ] Known limitations disclosed.

## 11. Claude Code execution rules

Claude Code must:
1. Read all documentation before modifying the repository.
2. Start with Phase 0; do not jump directly to feature implementation.
3. Inspect installed toolchains rather than assuming versions.
4. Report missing hardware/OS access that prevents verification.
5. Propose ADRs for architecture decisions not fixed by the docs.
6. Implement one phase or small vertical slice at a time.
7. Build and test both platforms where applicable.
8. Never fake OS integration with UI-only behavior.
9. Never claim real-device success without a real-device test.
10. Update this plan and related docs as decisions change.

## 12. First execution task

Perform Phase 0 only:
- Inspect the repository and local environment.
- Report macOS/Xcode/Swift versions.
- Report Windows/.NET environment availability and whether Windows hardware or VM is accessible.
- Identify dependencies and likely permission constraints.
- Validate a minimal LAN discovery and secure connection spike if both endpoints are available.
- Produce ADRs for unresolved choices.
- Create the initial repository skeleton only after presenting the proposed structure.
- Do not implement mouse/keyboard forwarding yet.
