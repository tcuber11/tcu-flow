# ADR-002 — Remote screen (view and control a linked computer in a window)

**Status:** Accepted, slice 1 implemented (owner request, 2 November 2026)

## Context

The owner wants to see and control a computer that is not in front of them. TCuFlow shares input only; PRD §6 listed remote desktop as a separate P2 decision. This ADR scopes it as an opt-in service on the existing pinned link, built in slices that each ship something testable.

## Decision

A `Screen` service (`kvm::Service::Screen = 7`) on the KVM endpoint, refused unless the shared side's user turned **Share my screen** on (`settings.sharing.screen`, off by default). The viewer opens it in a window (`remote-<fingerprint>`), sees the other computer's primary display, and its mouse and keyboard are injected there through the same `platform::Injected` path the edge-crossing uses.

### Slice 1 (done)
- Capture: macOS ScreenCaptureKit (`screencapturekit` crate; needs Screen Recording permission), Windows Graphics Capture (`windows-capture` crate). Primary display only.
- Encode: JPEG (quality 70) at up to 20 fps, downscaled to ≤1600 px wide, unchanged frames skipped. ~2–6 MB/s on a busy screen: fine on Ethernet and good Wi-Fi, not for mobile data.
- Wire: `tag | u32 len | body` frames from the shared side (1 JPEG, 2 info, 3 error); fixed 9-byte input frames from the viewer (move normalized to the display, button, wheel, key as set-1 scancode, text). Documented in `src-tauri/src/screen.rs`.
- Viewer: canvas in a Tauri window; pointer over the image sends input, pointer off it gives the keyboard back; status bar with fps and KB/s.
- The phone simulator (`npm run sim`) also serves its host's screen so the viewer can be tried on one computer.

### Slice 2 (next)
- Hardware H.264 (VideoToolbox / Media Foundation) with WebCodecs decoding in the viewer; same framing, new tag.
- Multi-display choice; clipboard sync inside the viewer; a "being viewed" indicator on the shared side.

### Outside the network
Not a TCuFlow relay. Tailscale (or any VPN) makes the linked computer reachable: add its Tailscale IP under **Add by IP** on both sides. Documented in `docs/guides/remote-mac-from-iphone.md`; an iPhone viewer would be a separate project (ADR-001 scope note).

## Consequences

- The shared side's screen leaves that computer only to linked devices, over the pinned TLS link, and only while the toggle is on. Lock screen and UAC are never captured (Windows) or controllable.
- Input injection from the viewer bypasses the edge-crossing session state: there is no cursor hide/park on the shared side, and held keys are not tracked for release-on-drop in slice 1 (the viewer sends key-up as it gets it; a dropped link mid-keypress can leave a modifier held until the next press there).
- macOS first use triggers the Screen Recording prompt; the refusal text tells the viewer which setting to open on the other Mac.
- Real-hardware verification (Mac ↔ Windows) is still pending, like the rest of the input path.
