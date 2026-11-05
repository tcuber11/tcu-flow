---
name: TCuFlow
description: One Workspace. Multiple Devices. Zero Friction.
colors:
  ink: "#eceef6"
  raised: "#ffffff"
  sunken: "#f1f2f8"
  fg: "#1c1f33"
  muted: "#5f6580"
  faint: "#686e88"
  line: "rgb(30 40 90 / 0.1)"
  accent: "#5b63f0"
  warm: "#ee7a3e"
  on-accent: "#ffffff"
  danger: "#d70015"
  success: "#248a3d"
  warning: "#c45500"
  ink-dark: "#14152a"
  raised-dark: "#23254a"
  sunken-dark: "#1b1d3a"
  fg-dark: "#eef0ff"
  muted-dark: "#a7abc9"
  faint-dark: "#9a9ebd"
  line-dark: "rgb(255 255 255 / 0.09)"
  accent-dark: "#7b82ff"
  danger-dark: "#ff6961"
  success-dark: "#30d158"
  warning-dark: "#ffb340"
typography:
  page-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Display, Segoe UI Variable Display, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI Variable Text, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  device-name:
    fontSize: "17px"
    fontWeight: 600
  body:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  meta:
    fontSize: "12px"
    fontWeight: 400
  code-digit:
    fontSize: "28px"
    fontWeight: 600
rounded:
  control: "8px"
  row: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  panel-gap: "20px"
  panel-padding: "20px"
  row-padding: "16px"
  row-gap: "10px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
    height: "32px"
  button-secondary:
    backgroundColor: "rgb(0 0 0 / 0.07)"
    textColor: "{colors.fg}"
    rounded: "{rounded.control}"
    padding: "6px 16px"
    height: "32px"
  panel:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel-padding}"
  device-row:
    rounded: "{rounded.row}"
    padding: "{spacing.row-padding}"
  code-box:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    rounded: "{rounded.row}"
    width: "44px"
    height: "56px"
  status-pill:
    rounded: "{rounded.pill}"
    padding: "4px 10px"
---

> **Soft clay (November 2026), on every platform.** Pillowy rounded surfaces lit from above: `.clay` (panels and
> cards: highlight on top, shade below, soft drop), `.clay-key` (buttons and keys, pressed in on tap) and `.clay-dip`
> (wells: fields, pads, trays), on a page shading from cool grey-blue to warm cream (`--page`). Periwinkle accent
> (computers still take the user's glow colour), warm orange as the second colour, pastel device colours on phones
> (`clayOf`: lavender, mint, pink, butter, peach, sky), headings in the rounded system face. Dark mode is deep
> indigo with the same depth. The tokens below are the clay values; older notes further down that speak of the
> macOS System Settings look describe the layout, which stays.


# TCuFlow design system

## Overview

TCuFlow looks like a native system-settings pane: a white (or graphite) window, grouped panels with hairline borders, the system font, and one accent. The user pinned this world with a reference screenshot of a macOS "Linked Macs" pane. Personality lives in precise details, not decoration: per-device tinted avatars, the security code at decision size, tinted status pills with icons. Light and dark are equal citizens; the user picks System, Light or Dark in the header.

## Colors

- **Restrained strategy:** neutrals plus one accent. The accent defaults to system blue `#007aff` and is replaced by the edge-glow colour the user chooses (`--color-accent`, set at runtime by `applyAccent`).
- Accent as text always goes through `--color-accent-ink` (accent mixed 22% toward black in light, toward white in dark) so any glow colour stays legible.
- Translucent fills use `--color-tint` (black in light, white in dark) at low alpha: `bg-tint/[0.06]` for tracks and secondary buttons. Never hard-code `white/…` or `black/…` overlays.
- Status colours (danger, success, warning) appear only inside pills or as text, at 12% fill behind same-hue text.
- Device avatars: `.avatar` disc `oklch(0.95 0.045 h)` with glyph `oklch(0.62 0.15 h)` in light, `oklch(0.36 0.09 h)` / `oklch(0.88 0.11 h)` in dark; `h` comes from the device fingerprint.
- Dark tokens apply under `html[data-theme="dark"]`, or under `prefers-color-scheme: dark` when no theme is forced.

## Typography

System font only (SF Pro on macOS, Segoe UI Variable on Windows): this world is the OS's own. Ramp: page title 26/700, section title 17/600, device name 17/600, body 14–15/400, meta 12/400. Code digits 28/600 with tabular numerals. Tracking never below -0.025em.

## Layout

Single column, max 720px, 32px side padding, header row (this-computer chip, appearance switch, About). Top-level panels are separated by 20px. Inside a panel: title, one explanatory line, then content. Device rows stack with 10px gaps. Minimum window width 680px.

## Elevation & Depth

Flat. Panels and rows are separated by 1px hairline borders (`--color-line`), never by shadows. Shadows are reserved for things that float above the window: dialogs (`0 12px 40px rgb(0 0 0 / 0.25)`) and toasts (`0 8px 28px rgb(0 0 0 / 0.18)`). Modal backdrops are a plain `black/35` scrim without blur.

## Shapes

Panels 16px, device rows and code boxes 12px, buttons and inputs 8px, status pills and avatars fully round.

## Components

- **Primary button:** accent fill, white text, 32px tall. Used for the action that advances (Accept, Link).
- **Secondary button:** tint fill, foreground text (Reject, Select/Selected, Unlink, Change…).
- **Link button:** accent-ink text, no fill until hover (Wake up, Forget).
- **Status pill:** tinted fill + same-hue text + optional 14px icon: Incoming (warning), Waiting (accent), Linked (success), Needs setup (warning), Needs update (danger), Offline (neutral).
- **Code boxes:** six bordered boxes, one digit each, shown while a pairing is in progress (outgoing in the Discovery panel, incoming in the request row). The code is never shown when no pairing exists.
- **Device row:** avatar disc 52px, name, `OS · address` meta, status pill top right, actions below. Selection is an accent border plus a 3px accent halo.
- **Appearance switch:** three-segment control (display, sun, moon icons) with a raised white segment for the current choice.
- **Mascot (Flo):** `src/Mascot.tsx`, a chubby drop with a pointer tip and a small trailing wave; accent-coloured, or tinted by a device fingerprint. Moods: idle, searching, waiting, happy, sad. Used where personality belongs (empty state, About, update prompt, phone pairing sheet, app icon), never in device rows, which keep the avatar discs.
- **Icons:** `src/icons.tsx`, 20-unit grid, 1.6 stroke, round caps, `currentColor`.

## Do's and Don'ts

- Do keep one accent; let the glow colour replace it, never add a second.
- Do show trust state in words and icons, never colour alone.
- Do default focus to the safe choice (Reject) on trust decisions, with a focus ring only for keyboard users.
- Don't add controls the backend can't honour (no discovery toggle, no standing security code).
- Don't use shadows on panels or rows, blur on backdrops, or bounce easing; motion is expo-out (`--ease-out-expo`).
- Don't use Unicode glyphs or emoji as icons.
