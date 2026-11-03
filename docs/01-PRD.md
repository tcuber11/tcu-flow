# 01 — Product Requirements Document (PRD)

**Product:** TCuFlow  
**Version:** 2.0  
**Status:** Updated for the LOKA-based implementation (ADR-001)  
**Owner:** Product  
**Date:** 2 November 2026

## 1. Executive summary

TCuFlow is a local-network desktop application intended to make a macOS computer and a Windows computer feel like one extended workstation. The user operates both computers using the Mac's keyboard and pointing device. When the pointer crosses a configured edge of the Mac display, control moves to Windows; crossing the return edge restores control to Mac.

The product also shares the clipboard (text, pictures and copied files) in both directions and transfers files by dropping or dragging them across the edge. The primary setup is one Mac and one Windows PC; technically every TCuFlow install can drive and be driven by any paired device.

## 2. Problem statement

Users who work with a Mac and a Windows laptop often need to:
- switch between separate keyboards and pointing devices;
- manually copy text through chat, email, cloud drives or removable storage;
- repeatedly move files between computers;
- interrupt their workflow when switching devices.

TCuFlow aims to reduce this friction while keeping data on the local network.

## 3. Product vision

**One Workspace. Multiple Devices. Zero Friction.**

TCuFlow should feel like a natural extension of the user's workstation, not a remote desktop product.

## 4. Goals and success measures

### Product goals
1. Provide reliable pointer transition between Mac and Windows.
2. Allow Mac keyboard and pointing-device input to operate Windows during an active session.
3. Synchronize the clipboard (text, pictures, copied files) in both directions.
4. Transfer files in both directions with integrity validation.
5. Operate on a trusted LAN without a cloud dependency.
6. Fail safely when permissions or network connectivity are unavailable.

### MVP success measures
- A user can discover, pair and reconnect the two devices.
- Pointer transition works in both directions for the configured display arrangement.
- Keyboard, click and scroll input work on Windows during an active session.
- Emergency recovery always restores local Mac control.
- Clipboard text, pictures and copied files work bidirectionally without an infinite synchronization loop.
- A file can be transferred in either direction and arrives intact.
- The application reports permission and connection problems clearly.
- Core flows pass a real-hardware test matrix documented in IPD.

Latency goals are engineering targets, not guaranteed service levels:
- Local input forwarding: target below 20 ms under a suitable low-latency LAN, measured end-to-end.
- Small plain-text clipboard propagation: target below 500 ms under normal LAN conditions.
- File transfer: maximize available LAN throughput without compromising integrity or UI responsiveness.

## 5. Target users and primary use case

### Primary user
A person who owns and uses both a Mac and a Windows laptop at the same desk and wants to control both with one keyboard and pointing device.

### Primary scenario
- Mac is positioned physically to the left of Windows.
- Both devices are connected to the same trusted local network.
- TCuFlow is running on both devices and paired.
- User moves pointer to the right edge of Mac.
- Pointer/control transitions to Windows.
- Mac keyboard and trackpad/mouse operate Windows.
- User copies text or transfers files between the devices.
- User moves pointer across the return edge to regain Mac control.

## 6. Product scope

### MVP — Must have (P0)
- One desktop app for macOS and Windows; either computer can drive the other.
- LAN device discovery with manual IP fallback.
- Explicit secure pairing and device trust.
- Authenticated encrypted session.
- Connection status and heartbeat.
- Configurable left/right device arrangement (initially one display per device).
- Pointer boundary transition.
- Keyboard forwarding.
- Pointer movement, left/right click and vertical/horizontal scroll where supported.
- Emergency shortcut and local-control recovery.
- Bidirectional clipboard sharing (text up to 1 MiB, pictures up to 10 MB, copied files up to 1 GiB) with loop prevention; secrets marked by password managers stay home.
- Bidirectional file transfer: drop on the edge, drag across the edge, Send to / Open With, or Send files….
- Transfer progress, cancellation and integrity verification.
- Permission onboarding and clear error states.
- Local configuration; light and dark appearance.

### Later — Should have (P1)
- ~~Folder transfer.~~ Done (inherited from LOKA).
- Transfer retry and resumability.
- More display arrangement options (top/bottom).
- Multiple displays per computer.
- Transfer history filtering and clear-history controls.
- ~~Drag-and-drop workflow.~~ Done: files dragged across the edge.
- Windows-first controller mode, subject to architecture review.

### Future — Could have (P2)
- Multiple Windows agents or multiple controllers.
- Remote screen preview or remote desktop (separate product decision).
- Internet relay / remote access (requires separate threat model).
- ~~Images and file clipboard integration.~~ Done in MVP. Rich text remains future.
- ~~Linux support.~~ Shipped as inherited, untested builds (deb/rpm/AppImage) alongside Android (APK) and an iOS project limited to touchpad + files.

### Explicitly out of scope for MVP
- Screen streaming or remote desktop.
- Remote login or unattended public-internet access.
- Cloud account and cloud synchronization.
- Clipboard rich-text synchronization (formatting); pictures and files are in scope.
- Remote terminal, folder-as-drive, sound, microphone and notification sharing (present in LOKA, refused in TCuFlow).
- Arbitrary remote shell or command execution.
- Keystroke recording, keylogging, or input analytics.
- Silent device pairing or hidden input forwarding.

## 7. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Discover TCuFlow peers on the same LAN | P0 |
| FR-002 | Allow manual IP/port connection if discovery fails | P0 |
| FR-003 | Pair only after explicit user approval | P0 |
| FR-004 | Authenticate and encrypt every trusted session | P0 |
| FR-005 | Display peer identity and connection state | P0 |
| FR-006 | Configure relative device position | P0 |
| FR-007 | Detect pointer crossing at configured boundary | P0 |
| FR-008 | Route pointer movement to active peer | P0 |
| FR-009 | Forward keyboard input during active remote control | P0 |
| FR-010 | Forward supported click and scroll events | P0 |
| FR-011 | Restore local input on return transition, disconnect or emergency shortcut | P0 |
| FR-012 | Synchronize clipboard text, pictures and copied files in both directions | P0 |
| FR-013 | Prevent clipboard echo/loop and duplicate updates | P0 |
| FR-014 | Enable/disable clipboard sharing | P0 — done: "Its clipboard" under This computer shares, on by default |
| FR-015 | Transfer selected files in both directions | P0 |
| FR-016 | Show progress, speed, completion and failure states | P0 |
| FR-017 | Validate received content using SHA-256 | P0 — **gap:** transport (QUIC/TLS) integrity only |
| FR-018 | Cancel an active transfer | P0 |
| FR-019 | Recover safely after temporary network loss | P0 |
| FR-020 | Store settings and trusted-device metadata locally | P0 |
| FR-021 | Transfer folders | Done |
| FR-022 | Resume interrupted transfers | P1 |
| FR-023 | Support multiple displays and advanced layouts | P1 |
| FR-024 | Support multiple peer devices | P2 |

## 8. Non-functional requirements

### Security and privacy
- TLS 1.3 or a reviewed equivalent secure transport configuration.
- Strong peer authentication; discovery must never imply trust.
- Store private keys and secrets in OS credential stores (macOS Keychain; Windows DPAPI/Credential Manager). **Gap:** the identity key is currently a file in the app data directory.
- Do not log typed content, clipboard contents, file contents or secrets.
- Make remote-control state visible.
- Provide immediate local emergency recovery.
- Stop forwarding input when the session becomes invalid.
- Validate file names, paths, sizes and transfer metadata.
- Do not write received files outside the user-selected destination.
- No network listener should be exposed to the public internet by default.

### Reliability
- A lost connection must not leave keys logically pressed or input routed remotely.
- A permission failure must not crash the application.
- A peer restart must not create an untrusted session automatically.
- File integrity must be checked after transfer.
- Runtime session state must be cleared on shutdown.

### Usability
- Setup should explain required OS permissions in plain language.
- The active target device must be obvious.
- Users must be able to disconnect and reclaim local control quickly.
- Errors must include a useful recovery action.

### Performance
- Input events should be coalesced/rate-limited appropriately; do not flood the network with redundant pointer updates.
- File transfer must stream in bounded chunks and avoid loading entire files into memory.
- Background CPU and memory usage should remain low when idle.

## 9. User stories

1. As a Mac user, I want to discover my Windows laptop so I can connect without manually configuring network details.
2. As a user, I want to approve pairing on both devices so unknown computers cannot control my machine.
3. As a user, I want to move my pointer across the configured edge so I can switch computers naturally.
4. As a user, I want my Mac keyboard to operate Windows while the pointer is there.
5. As a user, I want scrolling and clicking to work on Windows from my Mac trackpad/mouse.
6. As a user, I want an emergency shortcut so I can regain control if the peer or network fails.
7. As a user, I want to copy text, a screenshot or files on one computer and paste them on the other.
8. As a user, I want to disable clipboard sharing when handling private information.
9. As a user, I want to select files and send them to the other computer with visible progress.
10. As a user, I want failed transfers to report the reason and allow retry.
11. As a user, I want to revoke a paired device if I no longer trust it.

## 10. UX principles

- Local-first and privacy-forward.
- Native-feeling interactions on each OS.
- Minimal setup, explicit permissions.
- Visible connection and input ownership.
- Predictable behavior over clever but fragile automation.
- Accessible status and error messaging.

## 11. Acceptance criteria

MVP is accepted only when:
- Mac and Windows can discover, pair and establish an authenticated encrypted session.
- Pointer crosses the configured edge and returns correctly.
- Keyboard, click and scroll are forwarded as specified.
- Disconnect and emergency shortcut restore local Mac input.
- Clipboard text, pictures and files work in both directions without repeated echo.
- Files transfer in both directions intact (SHA-256 verification still open, FR-017).
- Permissions can be denied and later granted without reinstalling.
- The app runs on LAN without internet after installation.
- No input or clipboard content is written to logs.
- Tests pass on the supported OS versions listed in TRD.

## 12. Risks and assumptions

- macOS input capture and event posting are permission-sensitive and may be affected by OS security changes.
- Windows input injection is subject to session integrity and secure desktop restrictions; UAC secure desktop is not supported in MVP.
- Different keyboard layouts and modifier semantics can create compatibility issues.
- Display scaling, multiple monitors and mixed DPI complicate pointer coordinate mapping.
- Wi-Fi quality may make latency inconsistent; Ethernet is preferred for performance testing.
- The initial product supports one Mac controller and one Windows agent only.

## 13. Decisions

| Question | Decision |
|---|---|
| Minimum supported macOS | Tauri 2's default minimum; only the current release (macOS 27) has been built so far |
| Minimum supported Windows | Windows 10 and 11 (QUIC/TLS is implemented in Rust, not SChannel) |
| Left/right only or also top/bottom | All four edges, per monitor |
| Windows agent: tray, startup, or both | Tray app; "Start with computer" off until the user turns it on |
| Default receive directory and overwrite policy | `Downloads/TCuFlow`; never overwrite (`name (2).ext`) |
| Emergency shortcut | Ctrl+Alt+Esc or double tap of Ctrl; Scroll Lock/F14 locks the pointer |
| Separate file port or multiplexed | Separate QUIC endpoints for KVM (53421) and transfers (53420) |
| Pairing handshake | Pinned self-signed certificates plus a commit–reveal 6-digit code on both screens |
| Clipboard scope | Text, pictures and copied files (owner decision, 2 November 2026) |
