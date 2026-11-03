# 03 — Application Flow Documentation (AFD)

**Product:** TCuFlow
**Version:** 2.0
**Status:** As built on the LOKA fork (see [ADR-001](adr/ADR-001-fork-loka.md))

## 1. Purpose

The user journeys, screens and states as the app implements them. Visual details live in [DESIGN.md](../DESIGN.md).

## 2. Navigation model

One window (the same on macOS and Windows) plus the tray menu.

**Main window, top to bottom**
- Header: this computer's avatar and name, Appearance (System / Light / Dark), About.
- Linked computers: title, linked-count pill, one-line guidance.
- Discovery panel: listening line, security code while pairing, Nearby computers list, Add by IP.
- Where your devices sit: screens map, device placement, glow colour and style.
- How it feels over there: pointer speed, edge delay, Ctrl/⌘ swap (when a linked device is selected).
- Test connection / Troubleshoot (selected device).
- This computer shares: clipboard (on by default), screen (off by default); Received files: destination folder.
- Recent clipboard; transfer toasts.

**Tray menu:** Control a placed device, Disconnect, Start with computer, About, Quit.

**About:** version, updates, permissions (Accessibility / Windows Firewall), diagnostics, links (including the LOKA credit).

## 3. First run

1. Install and open TCuFlow on both computers (same network).
2. macOS asks for **Accessibility** (and **Local Network** on macOS 15+); Windows Firewall asks to allow TCuFlow (Private network).
3. Each computer lists the other under **Nearby computers** within a few seconds.
4. If nothing appears: **Add by IP** with the address shown under "This computer's address" on the other computer.

## 4. Linking (pairing)

1. On computer A, press **Link** on computer B's row (or drag B onto a screen edge in the map).
2. A's Discovery panel shows **Security code** as six boxes once both sides have exchanged nonces; B's row shows a **Waiting** pill.
3. On B, A appears at the top of Nearby computers with an **Incoming** pill, the same six-box code, and **Accept** / **Reject** (Reject has default focus).
4. The user compares the codes and accepts on B.
5. Both rows switch to **Linked**; the header pill counts linked computers.
6. Reject, no answer (timeout) or an unreachable device shows **Declined**, **No answer** or **Couldn't reach it** on A's row with **Try again**.

Linking never starts with the computer or shares anything on its own; it only allows the two to reach each other.

## 5. Placing a device

1. In **Where your devices sit**, drag a linked device to the screen edge it sits beside on the desk (any of four edges, any monitor), or click it to place it on the first free edge.
2. Slide its box along the edge so the glow matches where the other computer physically is; set size, glow colour, opacity, thickness, and when the glow shows.
3. The other computer places this one on its matching edge automatically.
4. **Take off** removes the placement.

## 6. Using the other computer

1. Push the cursor into the glowing stretch of the edge: the cursor appears on the other computer; keyboard input goes there.
2. A status toast shows "Using ⟨device⟩ · Ctrl Alt Esc to return".
3. Return: push the cursor out of the other computer's opposite edge, press **Ctrl+Alt+Esc**, or double-tap **Ctrl**.
4. Link loss (sleep, Wi-Fi, crash): the cursor comes home within about 3 seconds and nothing stays pressed.
5. **Scroll Lock** (F14 on a Mac) locks the pointer to the screen it is on.
6. If crossing fails, the toast names the reason (for example, Accessibility not granted on the other side) and disappears after 8 seconds.

## 7. Clipboard

- Copy on one computer, move the cursor over, paste on the other: text, pictures (including screenshots) and copied files, in both directions.
- Secrets marked by password managers stay home; nothing is stored on disk.
- **Recent clipboard** lists the last 12 copies for re-copying.
- **This computer shares → Its clipboard** (on by default) turns it off for this computer in both directions; Recent clipboard keeps working.

## 8. File transfer

- Drop files or folders on the glowing edge, drag them across it, use **Send files…** on a device's context menu, Explorer **Send to → TCuFlow**, or Finder **Open With → TCuFlow**.
- Files land in `Downloads/TCuFlow` (or the folder chosen under **Received files**) without a confirmation on the receiving side; names never overwrite existing files.
- Both sides show progress, speed and time left; either side can cancel; the receiver can open the folder.
- **Ctrl+Alt+V** pastes the files that arrived last into the app in front.

## 8a. Viewing another computer's screen (remote screen, ADR-002)

1. On the computer to be viewed: **This computer shares → Its screen** on. macOS asks for Screen Recording the first time a viewer connects; until it is granted the viewer sees the refusal with the setting to open.
2. On the viewing computer: **View screen** on the linked device's row (or its context menu). A window titled with the device's name opens.
3. The window shows the other computer's main display (H.264; JPEG on a webview without video decoding); with several displays, numbered buttons in the status bar switch between them. While the pointer is over the image, mouse, wheel and keyboard go there; moving the pointer off the image gives the keyboard back. The status bar shows fps and KB/s.
4. The computer being viewed shows a banner "⟨device⟩ is viewing and controlling this screen" with **Stop sharing**.
5. Closing the window, Stop sharing, turning the toggle off, or losing the link ends the stream; keys and buttons the viewer held are released there.

## 9. Unlinking

- **Unlink** on a linked device's row (or its context menu) removes trust and placement on this computer.
- An offline linked device stays in the list as **Offline** with **Wake up** (Wake-on-LAN, when known) and **Forget**.

## 10. Device states

| State | Shown as |
|---|---|
| Not linked | Row with **Link** |
| Asking | **Waiting** pill, code in the Discovery panel |
| Incoming | **Incoming** pill, code boxes, Accept / Reject |
| Linked | **Linked** pill (or "Linked · place it"), Select / Unlink |
| Needs setup | Pill plus the fix (for example "allow Accessibility on the Mac") |
| Needs update | Different protocol version |
| Offline | Linked but not on the network |

## 11. Accessibility

- Every action is a real button reachable by keyboard; trust decisions default focus to the safe choice.
- Status is always words plus icon, never colour alone.
- The security code is read out digit by digit to screen readers.
- Reduced-motion settings stop entrance and listening animations.
- Light and dark themes both meet text contrast targets.

## 12. Open UX questions

- Whether incoming files should ask before landing for unknown file types.
- A visible indicator on the driven computer that it is being controlled through the edge (the remote-screen viewer already shows one).
