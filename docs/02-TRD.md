# 02 — Technical Requirements Document (TRD)

**Product:** TCuFlow  
**Version:** 1.0  
**Status:** Baseline architecture proposal

## 1. Purpose

This document defines the technical architecture and platform requirements for TCuFlow. It complements the product scope in PRD and the detailed data structures in BSD.

## 2. Architecture principles

1. Native OS integration for input, clipboard and permissions.
2. Local-first; no mandatory cloud services.
3. Authenticated peer-to-peer communication.
4. Separate control-plane concerns from file-transfer concerns.
5. Versioned protocol shared by both clients.
6. Fail-safe input routing and explicit user consent.
7. Bounded memory use and observable error states.
8. Keep platform-specific code behind interfaces so the protocol and domain logic remain testable.

## 3. System context

- **macOS Controller:** primary UI, pointer boundary detection, local input capture, session coordination, clipboard monitoring and file-send UI.
- **Windows Agent:** tray/background UI, session handling, input injection, clipboard integration and file receive UI.
- **LAN:** discovery and encrypted peer communication.
- **Local stores:** SQLite for non-secret preferences/device metadata/transfer history; OS credential stores for private keys and secrets.

No central backend is required for MVP.

## 4. Recommended technology stack

| Area | macOS | Windows |
|---|---|---|
| Language | Swift | C# |
| UI | SwiftUI | WPF or WinUI 3 (choose one after environment spike) |
| Runtime | Native macOS | Supported .NET LTS |
| Input capture | Core Graphics event tap / approved APIs | Not applicable for controller in MVP |
| Input injection | Core Graphics event posting where permitted | Windows `SendInput` |
| Clipboard | `NSPasteboard` | Windows clipboard APIs |
| Networking | Network.framework or vetted .NET-compatible protocol implementation | .NET networking |
| Discovery | Bonjour/mDNS | DNS-SD/mDNS-compatible implementation |
| Persistence | SQLite | SQLite |
| Secret storage | Keychain | DPAPI / Credential Manager |
| Logging | Unified logging with redaction | Microsoft.Extensions.Logging with redaction |

**Implementation decision:** use a protocol specification independent of Swift and C#. Choose serialization (for example, JSON for initial control messages and binary frames for file chunks) after measuring overhead and documenting framing. Avoid introducing a complex message broker.

## 5. Logical architecture

### macOS modules
- `AppShell`: lifecycle, menu bar and dashboard.
- `PermissionCoordinator`: permission checks and onboarding.
- `Discovery`: LAN peer discovery and manual connection.
- `Pairing`: trust establishment and revocation.
- `SessionManager`: authenticated session state machine.
- `DisplayTopology`: screen bounds, arrangement and coordinate mapping.
- `InputCapture`: local keyboard/pointer event capture while appropriate.
- `InputRouter`: local/remote ownership and event forwarding.
- `ClipboardService`: text change detection and origin tracking.
- `TransferService`: file selection, sending and progress.
- `Persistence`: settings and metadata.
- `Security`: certificate/key handling and policy enforcement.

### Windows modules
- `AgentShell`: tray icon, status window and lifecycle.
- `Discovery`: peer discovery and manual configuration.
- `Pairing`: approval and identity management.
- `SessionServer`: authenticated connection handling.
- `InputInjector`: validated input event injection.
- `ClipboardService`: text clipboard read/write with loop prevention.
- `TransferReceiver`: bounded chunk receiving and destination handling.
- `Persistence`: settings and transfer metadata.
- `Security`: key storage, peer validation and policy enforcement.

### Shared protocol package
- Message definitions.
- Schema/version constants.
- Error codes.
- Serialization/framing rules.
- Test fixtures.
- Compatibility tests.

## 6. Network design

### Discovery
- Use mDNS/DNS-SD to advertise a TCuFlow service on the local network.
- Advertise only minimum metadata: service name, protocol version and connection port.
- Do not include secrets or trust claims in discovery records.
- Provide manual IP/port entry when multicast discovery is blocked.
- Discovery results are untrusted until pairing and authentication succeed.

### Transport
- Use TCP with TLS 1.3 for MVP.
- Authenticate the peer against the identity established during pairing.
- Prefer one authenticated connection with logical message channels initially; use a separate data connection only if measurements justify it.
- Define explicit message framing and maximum frame sizes.
- Apply timeouts, rate limits, backpressure and bounded queues.
- Never accept arbitrary unauthenticated commands.

### Suggested message envelope
```json
{
  "protocolVersion": 1,
  "messageId": "uuid",
  "sessionId": "uuid",
  "sequence": 123,
  "type": "session.heartbeat",
  "sentAt": "2026-11-02T00:00:00Z",
  "payload": {}
}
```

This is an illustrative envelope. The final schema must define required fields, validation, size limits and compatibility behavior.

### Message categories
- `pairing.*`: pairing request, approval, confirmation, revoke.
- `session.*`: start, heartbeat, end, state.
- `input.*`: pointer, button, scroll, key down/up, release-all.
- `clipboard.*`: text update, acknowledgement, disable/enable.
- `transfer.*`: offer, accept, reject, chunk, progress, cancel, complete, error.
- `system.*`: capability negotiation and structured error.

### Input event rules
- Sequence events and preserve ordering where required.
- Coalesce pointer movement where safe; do not coalesce key-down/key-up or button state transitions.
- Validate numeric ranges and event types.
- Apply rate limiting and bounded queues.
- Send an explicit release-all state on session shutdown or loss where possible.
- If the session is lost, immediately stop remote forwarding and restore local input ownership.
- Do not persist or log key content.

## 7. Input control and screen topology

### Pointer transition
- Represent each display as a rectangle in a virtual topology.
- Store relative device placement and selected display.
- Detect pointer proximity/crossing at the configured edge.
- Map the pointer's normalized position along the source edge to the destination edge.
- Clamp coordinates to destination bounds.
- Account for display scale factor and coordinate origin differences.
- Add a small transition hysteresis/debounce to prevent accidental rapid bouncing.
- Ensure the user can always invoke the local emergency shortcut.

### Keyboard
- Define a platform-neutral key event model.
- Preserve key-down/key-up pairing.
- Map modifier keys and keyboard layout differences deliberately.
- Negotiate capabilities and report unsupported keys.
- Avoid sending sensitive input when no authenticated active session exists.

### macOS constraints
- Explain and request relevant Accessibility and Input Monitoring permissions.
- Event tap availability and event posting may vary with OS version and security settings.
- Handle event-tap timeout/disable conditions and re-enable only through a controlled recovery path.
- Do not bypass OS security controls.
- Do not claim input control works on login screens or secure system surfaces.

### Windows constraints
- Use supported user-session input injection APIs such as `SendInput`.
- Run the interactive agent in the logged-in user session.
- Do not rely on Session 0 services to inject input into the interactive desktop.
- UAC secure desktop, lock screen, elevated integrity boundaries and protected surfaces may block input; document as restricted.
- Handle session lock/unlock and user switching by stopping the active remote-control session.

## 8. Clipboard design

- MVP supports plain text only.
- Use a content fingerprint and origin/session sequence to prevent echo loops.
- Distinguish local user changes from changes applied by the peer.
- Do not transmit when clipboard sharing is disabled.
- Provide a visible indicator and immediate disable control.
- Apply payload size limits and reject unsupported content.
- Do not write clipboard contents to logs or persistent history.

## 9. File transfer design

- User explicitly selects files and destination.
- Send metadata first: transfer ID, sanitized file name, size, content type if available, and checksum strategy.
- Stream in bounded chunks.
- Validate transfer ID, chunk index, expected size and destination.
- Write to a temporary file in the selected destination area; finalize/rename only after integrity verification.
- Avoid path traversal and unsafe overwrite behavior.
- Ask before overwriting an existing file.
- Support cancellation and cleanup of partial files.
- P1: resume support using verified chunk offsets and transfer identity.
- Never execute received files automatically.

## 10. Security architecture

### Threats to address
- Unknown LAN peer attempts to connect.
- Spoofed discovery advertisements.
- Man-in-the-middle during pairing.
- Unauthorized remote input.
- Clipboard disclosure.
- Malicious file names or path traversal.
- Replay or reordering of control messages.
- Resource exhaustion via oversized messages or transfer floods.
- Credential leakage through logs or local files.

### Controls
- Pairing requires user approval on both endpoints.
- Establish a cryptographic peer identity and bind it to the trusted-device record.
- Use TLS 1.3 with peer authentication/pinning strategy documented and tested.
- Use short-lived pairing tokens and rate-limit attempts.
- Validate every message against schema, session state and capability policy.
- Apply message size limits, transfer quotas and timeouts.
- Store secrets only in OS credential stores.
- Redact logs.
- Provide device revocation.
- Bind listener to local interfaces; firewall guidance must be explicit.
- No public relay or internet listener in MVP.

Pairing cryptography and certificate lifecycle must receive a security review before release. Do not invent a custom cryptographic protocol.

## 11. Reliability and state management

Session states:
`disconnected -> discovered -> pairing -> paired -> connecting -> connected-local -> connected-remote-control -> recovering -> disconnected`

Only valid transitions are permitted. A connection drop from remote-control state must immediately:
1. stop forwarding input,
2. release any tracked remote key/button states,
3. restore local input,
4. display disconnected/recovering status,
5. attempt reconnect according to policy,
6. require a valid authenticated session before remote control resumes.

## 12. Observability

- Structured logs for lifecycle, state changes, errors, transfer metadata and performance counters.
- Never log raw keyboard events, clipboard contents, file contents, private keys or pairing secrets.
- Provide diagnostic export with redaction.
- Record protocol version, OS version, app version and non-sensitive error codes.
- Performance measurements should be opt-in or local-only.

## 13. Testing requirements

- Unit tests: coordinate mapping, state machine, schema validation, clipboard loop prevention, transfer chunking.
- Integration tests: discovery, pairing, TLS session, reconnect, bidirectional clipboard and file transfer.
- Platform tests: permission denied/granted, sleep/wake, lock/unlock, multiple display scale factors.
- Security tests: untrusted peer, invalid certificate, replay, oversized frame, path traversal, malformed metadata.
- Performance tests: input latency distribution and file throughput.
- Real hardware testing is mandatory for input forwarding.

## 14. Packaging and deployment

- macOS: signed/notarized app for distribution outside local development; document required permissions.
- Windows: signed installer or MSIX/MSI decision after packaging spike; agent must run in interactive user session.
- Provide version compatibility and upgrade behavior.
- Do not auto-enable remote control after an upgrade without user consent.

## 15. Technical decisions requiring validation

- Minimum OS versions.
- SwiftUI app lifecycle and menu-bar behavior.
- WPF vs WinUI 3.
- mDNS library compatibility and firewall behavior.
- Pairing and certificate provisioning design.
- Single multiplexed TLS connection vs separate file channel.
- Exact input event representation and keyboard mapping.
- Multi-monitor topology model.
- Installer and signing approach.

Record each decision in an Architecture Decision Record (ADR) before implementation.
