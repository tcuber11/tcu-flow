# 04 — Design Brief Document (DBD)

**Product:** TCuFlow  
**Version:** 1.0  
**Status:** Visual and interaction baseline

## 1. Design objective

Create a premium, calm and efficient desktop utility that makes multiple computers feel like one workspace. The UI should be clear and trustworthy rather than visually busy.

## 2. Brand direction

### Product name
**TCuFlow**

### Tagline
**One Workspace. Multiple Devices. Zero Friction.**

### Brand attributes
- Seamless
- Reliable
- Private
- Precise
- Minimal
- Technical but approachable

### Visual concept
Use a dark-first interface with a restrained purple/blue accent and clear status colors. The TCu identity should be recognizable without dominating the interface.

## 3. Design principles

1. **Clarity over decoration:** connection state and active input target must be immediately understandable.
2. **Trust is visible:** pairing, clipboard and remote-control status must never be hidden.
3. **Native conventions:** use familiar macOS and Windows patterns where appropriate.
4. **Low interruption:** use subtle notifications rather than modal dialogs for routine state changes.
5. **Recovery first:** emergency disconnect/reclaim control must be obvious.
6. **Accessible:** support keyboard navigation, contrast, dynamic text where practical and non-color status cues.

## 4. Color and theme tokens

These are proposed design tokens, not final brand assets. Validate contrast before release.

| Token | Suggested value | Usage |
|---|---|---|
| `bg.canvas` | `#101116` | Main background |
| `bg.surface` | `#191B24` | Cards and panels |
| `bg.elevated` | `#222532` | Menus and dialogs |
| `text.primary` | `#F4F5F8` | Main text |
| `text.secondary` | `#A3A8B7` | Secondary text |
| `accent.primary` | `#8B7CFF` | Primary action and focus |
| `accent.secondary` | `#55B8FF` | Supporting accent |
| `status.success` | `#35C98A` | Connected/completed |
| `status.warning` | `#F4B860` | Pending/degraded |
| `status.error` | `#F16B73` | Failed/disconnected |
| `border.subtle` | `#303342` | Dividers and outlines |

Support light mode as a later enhancement. Do not hardcode colors in individual components; use semantic tokens.

## 5. Typography

- Prefer the native system font on each platform.
- Use clear hierarchy: page title, section title, body, caption and metadata.
- Avoid excessive all-caps labels.
- Use tabular numerals for transfer speed, file size and latency.
- Do not rely on tiny text for important connection information.

## 6. Layout and components

### Main macOS window
- Sidebar navigation.
- Main content panel.
- Optional compact status/connection area.
- Menu-bar presence for quick access.
- Resizable window with sensible minimum dimensions.

### Core components
- Device card.
- Connection status pill.
- Active-control banner.
- Device arrangement tile.
- Permission warning panel.
- Toggle row with description.
- Transfer queue row.
- Progress bar.
- Empty state.
- Error/retry panel.
- Confirmation dialog.

### Status semantics
- Connected: green + text + icon.
- Disconnected: neutral/red + text + icon.
- Pairing: amber + text + progress.
- Remote control active: distinct accent treatment and explicit device name.
- Clipboard enabled: visible toggle and status.
Never communicate status by color alone.

## 7. Screen specifications

### 7.1 Dashboard
Must show:
- TCuFlow identity.
- Current connection state.
- Paired Windows device name.
- Active input target (Mac or Windows).
- Keyboard & Mouse Sharing toggle.
- Clipboard Sharing toggle.
- Quick disconnect / reclaim control.
- Recent transfer summary.

Primary action changes according to state: `Find Device`, `Pair`, `Connect`, or `Disconnect`.

### 7.2 Devices
- Discovered devices section.
- Paired devices section.
- Device name, OS, app version and connection state.
- Pair/connect/revoke actions.
- Manual IP connection fallback.

### 7.3 Display Arrangement
- Simple visual representation of Mac and Windows display tiles.
- Drag-to-position interaction for supported directions.
- Clear edge indicator.
- Display selection if multiple displays are detected.
- Test transition and reset layout actions.

### 7.4 Keyboard & Mouse
- Sharing toggle.
- Configured transition edge.
- Emergency shortcut configuration.
- Permission status.
- Supported capability list.
- Troubleshooting link.

### 7.5 Clipboard
- Plain-text sharing toggle.
- Clear explanation of what is shared.
- Current session status.
- Privacy note: contents are not stored in history or logs.

### 7.6 File Transfer
- Send files action.
- Selected destination device.
- Transfer queue with file name, size, progress, speed and state.
- Cancel/retry actions.
- Receive destination setting.
- Overwrite confirmation.

### 7.7 Settings
Sections:
- General
- Devices
- Display Arrangement
- Keyboard & Mouse
- Clipboard
- File Transfer
- Security & Privacy
- Diagnostics / About

## 8. Interaction and motion

- Use short, subtle transitions (approximately 150–220 ms where suitable).
- Avoid animation that delays input or blocks interaction.
- Pointer transition should feel immediate; a small visual cue may indicate target change.
- Use native file pickers and OS permission prompts.
- Confirmation dialogs for trust, revocation and overwrite.
- No modal dialog for every pointer transition.

## 9. Notifications

Examples:
- “Connected to [Device Name].”
- “Keyboard and mouse control is now on [Device Name].”
- “Control returned to this Mac.”
- “Connection lost. Local control restored.”
- “File transfer completed.”
- “Clipboard sharing is off.”

Notifications must not expose clipboard text or sensitive file contents.

## 10. Accessibility

- Keyboard-accessible navigation and controls.
- VoiceOver/Narrator labels for status and controls.
- Minimum contrast consistent with WCAG guidance where applicable.
- Scalable text and layout.
- Visible focus states.
- Reduced-motion support.
- Avoid status conveyed only through color or animation.

## 11. Responsive behavior

This is a desktop-first product, not a mobile app. The window should adapt to compact and expanded desktop sizes. At compact widths, prioritize connection state, active target, sharing toggles and emergency action.

## 12. Design deliverables for implementation

Before full UI implementation, create:
- Low-fidelity wireframes for all primary screens.
- High-fidelity dashboard and display arrangement.
- Component inventory.
- Semantic design token file.
- Empty, loading, connected, disconnected, permission-denied and error states.
- Accessibility review checklist.

Do not create decorative screens that imply functionality not implemented.
