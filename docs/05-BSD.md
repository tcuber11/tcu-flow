# 05 — Backend / Storage Schema Document (BSD)

**Product:** TCuFlow
**Version:** 2.0
**Status:** As built on the LOKA fork (see [ADR-001](adr/ADR-001-fork-loka.md))
**Date:** 2 November 2026

## 1. Purpose and terminology

TCuFlow has no server. "Backend" here means the Rust side of the desktop app and the state it keeps on disk. Version 1.0 proposed a SQLite schema; the LOKA base stores a small JSON file instead, and this document describes that.

## 2. Storage principles

- One app data directory per install: `dev.tcuflow.app` under the OS's app data location (macOS `~/Library/Application Support/dev.tcuflow.app`, Windows `%APPDATA%\dev.tcuflow.app`).
- Persistent: pairings, edge placement, preferences, the device identity.
- Never persistent: keystrokes, pointer events, clipboard contents, file contents, pairing nonces, session state.
- A missing or corrupt settings file means "nothing paired"; the app starts clean instead of crashing.

## 3. Files on disk

| File | Content | Sensitive |
|---|---|---|
| `settings.json` | Pairings, portals, hosts, preferences (section 4) | Low (aliases, IPs) |
| `identity.crt` | This device's self-signed certificate (DER) | No (public) |
| `identity.key` (Linux/mobile, 0600) · `identity.key.dpapi` (Windows) · login keychain item (macOS) | Its private key (PKCS#8 DER) | **Yes** |
| `logs/tcuflow.log`, `logs/tcuflow.1.log` | Lifecycle and error log, rotated at 1 MiB | Low; no content is logged |

UI-only preferences live in the webview's localStorage: `tcuflow.theme`, `tcuflow.look` (glow colour and style), `tcuflow.sound`, `tcuflow.selected`.

## 4. `settings.json`

```json
{
  "paired": [{ "fingerprint": "<sha-256 hex>", "alias": "Office PC" }],
  "portals": {
    "<fingerprint>": { "edge": "right", "monitor": { "x": 0, "y": 0, "w": 3024, "h": 1964 }, "start": 0.25, "end": 0.75, "reach": 0 }
  },
  "hosts": ["192.168.1.31"],
  "cursor": { "speed": 1.0, "edgeDelayMs": 0, "swapCtrlCmd": true },
  "sharing": { "terminal": false, "folder": null, "sound": false, "notifications": false, "mic": false },
  "received": null,
  "macs": { "<fingerprint>": "aa:bb:cc:dd:ee:ff" },
  "start_with_computer": false
}
```

| Field | Meaning |
|---|---|
| `paired` | Trusted devices, keyed by certificate fingerprint; the alias is display only |
| `portals` | Which stretch of which monitor edge leads to which paired device |
| `hosts` | Addresses added by hand for networks that drop multicast |
| `cursor` | Pointer speed on the other device, edge delay, Ctrl/⌘ swap |
| `sharing` | Inherited from LOKA; ignored by TCuFlow (services refused, section 6) |
| `received` | Receive folder; `null` = `Downloads/TCuFlow` |
| `macs` | Hardware addresses announced by paired devices, for Wake-on-LAN |
| `start_with_computer` | Login item; off until the user turns it on in the tray |

Unknown fields are ignored and missing fields take defaults, so files from older versions load.

## 5. Runtime-only data

Held in memory and dropped when the session or app ends: the QUIC connections, active KVM session and which device has input, held keys/buttons (released on link loss), pairing nonces and codes, transfer buffers, the last clipboard sent/received (to stop echo), and the Recent clipboard list (last 12 entries).

## 6. Removed services

`sharing.*` is kept in the file format for compatibility with the LOKA code, but `allow_service` refuses terminal, folder, sound, microphone and notification services whatever it says.

## 7. Retention and deletion

- **Unlink** removes the device from `paired` and `portals`.
- Received files stay where they landed; partial files of a cancelled or failed transfer are removed.
- Deleting the app data directory resets TCuFlow completely, including its identity (other devices must pair again).

## 8. Known gaps against PRD

| PRD requirement | Status |
|---|---|
| Private keys in Keychain / DPAPI | Done: Keychain (macOS), DPAPI (Windows), owner-only file elsewhere; migration from the plain file on first start |
| Transfer history (metadata) persisted | Transfers are shown for the session only; no history is stored |
| Versioned migrations | Not needed for the JSON file today (tolerant defaults); add a version field before any breaking change |
