# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Desktop app: a Tauri 2 webview UI shipped on macOS and Windows. Linux and Android code inherited from LOKA remains but is not a design target.)

## Users

One person who owns and uses a Mac and a Windows laptop at the same desk and wants to drive both with one keyboard and pointing device, without cloud services or accounts.

## Product Purpose

Make two computers on a trusted LAN feel like one workstation: the cursor crosses a configured screen edge onto the other computer, keyboard input follows it, the clipboard (text, images and copied files) follows it, and files can be sent either way. Success: pairing once, then switching computers without thinking about it, and always being able to reclaim local control.

## Positioning

Local-first input sharing, not remote desktop: no screen streaming, no relay, no account. Devices are identified by pinned certificate fingerprints and paired by comparing a 6-digit code on both screens.

## Operating Context

- Used beside other work, mostly from the tray; the main window is opened for pairing, edge placement, settings and transfers.
- Pairing happens with both screens visible to the same person.
- Emergency return: Ctrl+Alt+Esc or double-tap Ctrl.

## Capabilities and Constraints

- Discovery on the LAN plus Add by IP; pairing requires acceptance on the other device.
- Edge portal placement per device; pointer speed and edge delay.
- Clipboard: text, images (up to 10 MB) and copied files, both directions.
- File send by drag to the edge, Send to / Open With, with progress and cancel.
- Not offered: remote terminal, folder-as-drive, sound, microphone and notification sharing.
- macOS needs Accessibility (and Local Network on 15+). Windows secure desktop/UAC cannot be controlled.

## Brand Commitments

- Name: TCuFlow. Tagline: "One Workspace. Multiple Devices. Zero Friction."
- Based on LOKA by Aufa Nirsad (Apache-2.0); the credit in About, NOTICE and README must stay.

## Evidence on Hand

No screenshots, testimonials or benchmarks of TCuFlow exist yet. Real-hardware verification is still pending; do not claim features work beyond what is verified.

## Product Principles

1. Control state is always visible: which computer the keyboard and mouse are on, and how to get them back.
2. Trust is explicit: nothing pairs, shares or starts with the computer without the user turning it on.
3. Native-feeling on each OS; predictable over clever.
4. Nothing leaves the local network.

## Accessibility & Inclusion

Keyboard-operable primary actions, status never by color alone, readable contrast in both light and dark themes, reduced-motion support.
