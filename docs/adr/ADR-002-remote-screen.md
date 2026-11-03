# ADR-002 — Remote screen (view and control a linked computer in a window)

**Status:** Accepted; slice 1 implemented 2 November 2026, slice 2 (H.264, indicator, key release) 3 November 2026

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

### Slice 2 (done, 0.9.8+)
- H.264 through OpenH264 (screen-content real-time mode, 3 Mbit/s, built from source for every platform) with WebCodecs decoding in the viewer; same framing, tag 4 `key | w | h | Annex B`. The viewer asks for video with input frame 6 once it knows its webview decodes (WebKit 16.4+, WebView2); JPEG stays the first frames and the fallback on any decode error. Hardware encoders (VideoToolbox / Media Foundation) can replace OpenH264 behind `screen::H264` later: ~5–10× less CPU, same wire.
- A "being viewed" banner on the shared side (`screen-viewed` event) with **Stop sharing**, which ends every stream (`screen::stop_sharing`), as does turning the toggle off.
- Keys and buttons the viewer holds are released when its stream ends.

### Slice 3
- Multi-display (done): the capture backend lists its displays with their physical bounds (ScreenCaptureKit + CoreGraphics on macOS, `GetMonitorInfoW` on Windows); tag 2 carries the list, the viewer shows a picker when there is more than one, input frame 7 switches the shared display mid-stream (the encoder restarts on the new size).
- Clipboard inside the viewer (done): text copied on either side while the window is open lands on the other (tag 5 down, input frame 8 up, both honouring "Its clipboard"), so copy there / paste here works without an edge crossing.
- Hardware encoding on the Mac (done): `screen::H264` opens a VideoToolbox session (the media engine; RealTime, baseline, no frame reordering, 3 Mbit/s, called synchronously per frame) and falls back to OpenH264 when it can't. Windows keeps OpenH264: a Media Foundation hardware encoder (async MFT, NV12) can only be proven on a PC with a GPU, which CI doesn't have.
- Video is never dropped once encoded (the encoder thread waits for the link; the capture slot drops raw frames meanwhile). A viewer whose decoder falls behind or fails asks for a key frame (input frame 9) and skips deltas until it arrives; the shared side re-sends a still screen as that key frame. A second decode failure in a row goes back to JPEG.

### Outside the network
Not a TCuFlow relay. Tailscale (or any VPN) makes the linked computer reachable: add its Tailscale IP under **Add by IP** on both sides. Documented in `docs/guides/remote-mac-from-iphone.md`; an iPhone viewer would be a separate project (ADR-001 scope note).

## Consequences

- The shared side's screen leaves that computer only to linked devices, over the pinned TLS link, and only while the toggle is on. Lock screen and UAC are never captured (Windows) or controllable.
- Input injection from the viewer bypasses the edge-crossing session state: there is no cursor hide/park on the shared side. Keys and buttons held when the stream ends are released by the shared side (slice 2).
- macOS first use triggers the Screen Recording prompt; the refusal text tells the viewer which setting to open on the other Mac.
- Real-hardware verification (Mac ↔ Windows) is still pending, like the rest of the input path.
