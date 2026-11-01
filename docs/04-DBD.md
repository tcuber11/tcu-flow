# 04 — Design Brief Document (DBD)

**Product:** TCuFlow
**Version:** 2.0
**Status:** Updated 2 November 2026. Tokens and component rules now live in [DESIGN.md](../DESIGN.md); this brief keeps intent and decisions.

## 1. Design objective

A calm, trustworthy desktop utility that makes two computers feel like one workspace. It should read like part of the operating system, not like a separate brand experience.

## 2. Brand

- **Name:** TCuFlow
- **Tagline:** One Workspace. Multiple Devices. Zero Friction.
- **Attributes:** seamless, reliable, private, precise, minimal.
- **Credit:** based on LOKA by Aufa Nirsad; the credit stays in About, NOTICE and README.

## 3. Direction (decided)

Version 1.0 proposed a dark-first purple/blue look. The owner replaced it with a reference: a macOS System Settings pairing pane ("Linked Macs"). The built direction:

- White window and panels in light mode; graphite in dark mode; System / Light / Dark switch in the header.
- System font (SF Pro / Segoe UI Variable), one accent (system blue by default, replaced by the user's edge-glow colour).
- Hairline-bordered grouped panels, no decorative shadows or blur.
- LOKA's "Oka" mascot is replaced by device avatars: a disc tinted per device with a laptop or phone glyph.
- The security code is shown as six digit boxes, only while a pairing is in progress.

## 4. Design principles

1. **Trust is visible:** linked state, incoming requests and the security code are never hidden or abbreviated.
2. **Truthful controls:** nothing is drawn that the app cannot do (no discovery toggle, no standing code).
3. **Native conventions:** system font, system-style buttons and segmented controls, OS dialogs and file pickers.
4. **Low interruption:** incoming requests appear inline in the device list; toasts for routine states.
5. **Recovery first:** the return shortcut is shown whenever input is on another computer.
6. **Accessible:** keyboard reachable, words plus icons for status, contrast in both themes, reduced motion.

## 5. Screens

| Screen | Purpose |
|---|---|
| Linked computers + Discovery | See nearby and linked computers, link, accept/reject with the code, add by IP |
| Where your devices sit | Place linked devices on screen edges; glow colour and style |
| How it feels over there | Pointer speed, edge delay, Ctrl/⌘ swap |
| Received files | Destination folder, paste-last-arrival shortcut |
| Recent clipboard | Last 12 copies |
| About | Version, updates, permissions, diagnostics, links |
| Edge overlay | The glowing portal on the screen edge (transparent window) |

## 6. Notifications and copy

- "Using ⟨device⟩ · Ctrl Alt Esc to return"
- "Couldn't move over: ⟨reason⟩"
- "Pointer locked here · Scroll Lock to release"
- Transfer toasts with progress, speed and time left.
Notifications never include clipboard text or file contents.

## 7. Open design items

- Dark-mode avatar discs at yellow-green hues read muddy; consider a lightness lift for those hues.
- The placement map keeps generous empty space for top/bottom drop zones; a tighter layout needs a design for drag targets.
- Phone (Android) views keep LOKA's layout with the new tokens; they are not a design target.
