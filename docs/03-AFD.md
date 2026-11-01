# 03 — Application Flow Documentation (AFD)

**Product:** TCuFlow  
**Version:** 1.0  
**Status:** Baseline interaction specification

## 1. Purpose

This document defines the main user journeys, screen transitions, session states and expected behavior. It describes what the user experiences rather than the implementation details.

## 2. Navigation model

### macOS Controller
- Dashboard
- Devices
- Display Arrangement
- Keyboard & Mouse
- Clipboard
- File Transfer
- Transfer History
- Settings
- Help / Diagnostics

### Windows Agent
- Tray status
- Connection request / pairing approval
- Active session status
- Clipboard sharing status
- Incoming transfer approval / destination
- Settings
- Diagnostics

## 3. First-run onboarding

### Preconditions
- TCuFlow is installed on both computers.
- Both computers are on the same trusted LAN.
- The user is logged in to the normal desktop session.

### Flow
1. Launch TCuFlow on Mac.
2. Show welcome screen and explain local-network-only behavior.
3. Explain that input forwarding and clipboard sharing are opt-in.
4. Check required macOS permissions.
5. If permission is missing, show why it is needed and link to the relevant System Settings location where possible.
6. Launch TCuFlow Agent on Windows.
7. Discover Windows agent automatically.
8. User selects the Windows device.
9. Begin secure pairing.
10. User approves on Windows and confirms on Mac.
11. Save trusted-device metadata.
12. Show connection success.
13. Ask user to configure physical screen arrangement.
14. Show dashboard with sharing controls disabled until user explicitly enables them.

### Error paths
- No peer found: show manual IP option and network troubleshooting.
- Permission denied: explain unavailable features; do not pretend they work.
- Pairing rejected: return to device list and do not save trust.
- Pairing timeout: expire the request and allow retry.
- Unsupported protocol: show version mismatch and upgrade guidance.

## 4. Device discovery and pairing flow

1. Open Devices screen.
2. Show discovered devices with name, OS, app version and network status.
3. User selects a device.
4. Show identity details and pairing code/confirmation.
5. Windows displays a request naming the Mac.
6. User approves or rejects on Windows.
7. Mac confirms the same pairing attempt.
8. Exchange/validate peer identity.
9. Save trust metadata.
10. Show `Paired` state.

Pairing must never automatically enable remote input or clipboard synchronization.

## 5. Connection flow

1. User selects a paired device.
2. Mac starts an authenticated connection.
3. Both endpoints negotiate protocol version and capabilities.
4. Session becomes `Connected`.
5. Dashboard shows latency estimate and supported capabilities where available.
6. Input sharing and clipboard sharing remain governed by explicit toggles.

If authentication fails, terminate the connection and show a security-oriented error. Do not downgrade to plaintext.

## 6. Display arrangement flow

1. Open Display Arrangement.
2. Show Mac and Windows display tiles.
3. User drags the Windows tile to the left/right of Mac (MVP default).
4. User selects the active display on each computer if necessary.
5. Show a simple preview of the boundary where pointer transition occurs.
6. User saves arrangement.
7. Run a guided test: move pointer to the selected edge.
8. If transition fails, show troubleshooting and provide a reset-to-local action.

The UI must not imply that the Windows laptop is a physical external display or that screen pixels are being extended. TCuFlow shares input, not video.

## 7. Remote-control flow

### Start
1. User confirms the paired device is connected.
2. User enables `Keyboard & Mouse Sharing`.
3. Dashboard shows an obvious active-control indicator and the target device.
4. User moves pointer to configured edge.
5. Pointer transition occurs.
6. Windows receives supported input events.
7. Mac shows a subtle state indicator that control is on Windows.

### Return
1. User moves pointer to the configured return edge, or invokes emergency shortcut.
2. Remote forwarding stops.
3. Local Mac control is restored.
4. Dashboard updates active target to Mac.

### Disconnect / failure
- On network loss, stop remote forwarding immediately.
- Release tracked remote key/button states where possible.
- Restore local input without waiting for reconnect.
- Show a non-blocking notification.
- Reconnect only after authentication succeeds.
- Do not automatically re-enter remote-control mode without an explicit safe policy and user-visible indication.

## 8. Clipboard flow

### Enable
1. User opens Clipboard settings.
2. User enables `Share plain-text clipboard`.
3. UI explains that copied text can be sent to the paired device.
4. A visible status indicator appears.

### Copy Mac -> Windows
1. User copies text on Mac.
2. Clipboard service detects a new local text value.
3. If sharing is enabled and a valid session exists, send the update with origin and sequence metadata.
4. Windows validates and applies the text.
5. Windows marks the update as peer-originated to prevent echo.
6. User pastes on Windows.

### Copy Windows -> Mac
Same flow in reverse.

### Disable
- User disables sharing.
- Stop future clipboard transmissions immediately.
- Do not clear either device's clipboard automatically.
- Do not persist clipboard content.

## 9. File transfer flow

### Send
1. User opens File Transfer.
2. User selects destination device.
3. User chooses files through native file picker.
4. App displays file names, total size and destination.
5. User confirms send.
6. Receiver asks for destination/approval according to configured policy.
7. Transfer begins.
8. UI displays per-file and total progress.
9. User may cancel.
10. Receiver validates size and checksum.
11. Completed files appear in selected destination.
12. Transfer history records metadata only.

### Failure
- Connection interrupted: mark transfer as interrupted and offer retry. Resume is P1 unless implemented and tested.
- Insufficient storage: show error and do not leave a misleading completed item.
- File exists: ask before overwrite.
- Invalid file/path: reject safely and explain.
- Checksum mismatch: do not finalize file; offer retry.

## 10. Device revocation flow

1. User opens Devices.
2. Selects paired device.
3. Chooses `Forget / Revoke Device`.
4. Confirmation explains that active sessions will end.
5. User confirms.
6. End session and remove trust relationship.
7. Remove locally stored credential reference securely.
8. Device returns to discoverable/unpaired state.

## 11. Screen states

### Dashboard states
- `No devices`: onboarding and discover action.
- `Device discovered`: pair action.
- `Paired, disconnected`: connect action.
- `Connected`: enable sharing controls.
- `Remote control active`: prominent target indicator and emergency action.
- `Recovering`: local control restored; reconnect status shown.
- `Permission required`: affected capability disabled with guidance.
- `Error`: concise reason and next action.

### Transfer states
- `Queued`
- `Awaiting approval`
- `Transferring`
- `Verifying`
- `Completed`
- `Cancelled`
- `Interrupted`
- `Failed`

## 12. Accessibility and interaction requirements

- All primary actions accessible by keyboard.
- Status is communicated with text/icon, not color alone.
- Provide readable contrast and scalable text.
- Avoid flashing or distracting transition effects.
- Confirmation dialogs must identify the device and action.
- Emergency recovery must be easy to discover and operate.

## 13. Flow diagrams

See:
- `diagrams/app-flow.mmd`
- `diagrams/session-sequence.mmd`

## 14. Open UX questions

- Should Windows require approval for every incoming file, or can a trusted-device setting remember the destination?
- Should clipboard sharing be disabled by default on every new session? Recommended: yes until user enables it.
- What should the default emergency shortcut be? Must be configurable and conflict-checked.
- Should the agent show a persistent tray indicator whenever remote control is active? Recommended: yes.
