# 05 — Backend / Storage Schema Document (BSD)

**Product:** TCuFlow  
**Version:** 1.0  
**Status:** Proposed local persistence model

## 1. Purpose and terminology

TCuFlow MVP has no central cloud backend. In this document, “backend schema” refers to local persistence and the data contract used by the desktop applications.

Each endpoint maintains its own local database. Sensitive credentials are stored in OS credential stores, not in SQLite.

## 2. Storage principles

- SQLite stores non-secret configuration and metadata.
- Key material and secrets stay in Keychain (macOS) or DPAPI/Credential Manager (Windows).
- Runtime input events and clipboard contents are not persisted.
- Transfer history stores metadata, not file contents.
- Session state is ephemeral and must be cleared on shutdown.
- Schema changes use versioned migrations.
- Use UTC timestamps in ISO 8601 or integer epoch milliseconds consistently; this specification recommends UTC ISO 8601 text for readability.
- Use UUID strings for cross-platform identifiers.

## 3. Logical entities

- `app_settings`: local preferences.
- `devices`: known discovered/paired peers.
- `trusted_device_credentials`: references to OS credential-store entries, never raw secrets.
- `device_layouts`: relative screen placement.
- `transfer_records`: transfer metadata and state.
- `transfer_items`: per-file metadata within a transfer.
- `schema_migrations`: applied migration versions.

Do not persist active keyboard state, raw input events, clipboard contents or private keys.

## 4. SQLite schema

### 4.1 app_settings

| Column | Type | Constraints | Description |
|---|---|---|---|
| `key` | TEXT | PK | Setting key |
| `value_json` | TEXT | NOT NULL | JSON-encoded non-secret value |
| `updated_at` | TEXT | NOT NULL | UTC timestamp |

Examples: clipboard enabled preference, startup preference, emergency shortcut, selected peer ID. Never store secrets here.

### 4.2 devices

| Column | Type | Constraints | Description |
|---|---|---|---|
| `device_id` | TEXT | PK | Stable TCuFlow peer UUID |
| `display_name` | TEXT | NOT NULL | User-visible device name |
| `platform` | TEXT | NOT NULL | `macos` or `windows` |
| `app_version` | TEXT | NULL | Last known app version |
| `protocol_version` | INTEGER | NULL | Last negotiated protocol version |
| `last_known_address` | TEXT | NULL | Last LAN address; may change |
| `last_seen_at` | TEXT | NULL | Last discovery/connection time |
| `is_paired` | INTEGER | NOT NULL DEFAULT 0 | 0/1 |
| `created_at` | TEXT | NOT NULL | UTC timestamp |
| `updated_at` | TEXT | NOT NULL | UTC timestamp |

Indexes:
- `idx_devices_paired` on `is_paired`
- `idx_devices_last_seen` on `last_seen_at`

Do not treat IP address as device identity.

### 4.3 trusted_device_credentials

| Column | Type | Constraints | Description |
|---|---|---|---|
| `device_id` | TEXT | PK, FK devices | Trusted peer |
| `credential_ref` | TEXT | NOT NULL | OS credential-store reference |
| `identity_fingerprint` | TEXT | NOT NULL | Public identity fingerprint |
| `paired_at` | TEXT | NOT NULL | Pairing timestamp |
| `last_verified_at` | TEXT | NULL | Last successful peer verification |
| `revoked_at` | TEXT | NULL | Revocation timestamp |

The `credential_ref` points to a Keychain/DPAPI/Credential Manager entry. Never store private key bytes, passwords, pairing secrets or bearer tokens in this table.

### 4.4 device_layouts

| Column | Type | Constraints | Description |
|---|---|---|---|
| `layout_id` | TEXT | PK | Layout UUID |
| `local_device_id` | TEXT | NOT NULL | Current device identity |
| `remote_device_id` | TEXT | NOT NULL, FK devices | Peer identity |
| `local_display_id` | TEXT | NULL | Selected local display |
| `remote_display_id` | TEXT | NULL | Selected remote display |
| `relative_position` | TEXT | NOT NULL | `left`, `right`, `top`, `bottom` |
| `is_default` | INTEGER | NOT NULL DEFAULT 0 | 0/1 |
| `created_at` | TEXT | NOT NULL | UTC timestamp |
| `updated_at` | TEXT | NOT NULL | UTC timestamp |

Constraint: one default layout per local/remote device pair. Enforce through a partial unique index if supported by the chosen SQLite version.

### 4.5 transfer_records

| Column | Type | Constraints | Description |
|---|---|---|---|
| `transfer_id` | TEXT | PK | Transfer UUID |
| `peer_device_id` | TEXT | FK devices | Other endpoint |
| `direction` | TEXT | NOT NULL | `send` or `receive` |
| `status` | TEXT | NOT NULL | queued/awaiting/transferring/verifying/completed/cancelled/interrupted/failed |
| `total_bytes` | INTEGER | NOT NULL DEFAULT 0 | Total bytes |
| `transferred_bytes` | INTEGER | NOT NULL DEFAULT 0 | Bytes transferred |
| `started_at` | TEXT | NULL | Start timestamp |
| `completed_at` | TEXT | NULL | Completion timestamp |
| `error_code` | TEXT | NULL | Non-sensitive error code |
| `created_at` | TEXT | NOT NULL | UTC timestamp |

Indexes:
- `idx_transfers_created_at` on `created_at`
- `idx_transfers_peer` on `peer_device_id`
- `idx_transfers_status` on `status`

### 4.6 transfer_items

| Column | Type | Constraints | Description |
|---|---|---|---|
| `item_id` | TEXT | PK | Item UUID |
| `transfer_id` | TEXT | NOT NULL, FK transfer_records | Parent transfer |
| `display_name` | TEXT | NOT NULL | Sanitized display name |
| `relative_path` | TEXT | NULL | Relative path for folder transfer (P1) |
| `size_bytes` | INTEGER | NOT NULL | Expected size |
| `sha256` | TEXT | NULL | Final content hash |
| `status` | TEXT | NOT NULL | Item transfer state |
| `created_at` | TEXT | NOT NULL | UTC timestamp |

Do not store absolute source paths unless a specific product requirement and privacy review justify it.

### 4.7 schema_migrations

| Column | Type | Constraints | Description |
|---|---|---|---|
| `version` | INTEGER | PK | Migration number |
| `name` | TEXT | NOT NULL | Migration name |
| `applied_at` | TEXT | NOT NULL | UTC timestamp |

## 5. Relationships

- One `devices` record can have zero or one active trusted credential record.
- One device can participate in many transfer records.
- One transfer record can contain one or more transfer items.
- One local/remote device pair can have one or more saved layouts, with at most one default.

See `diagrams/erd.mmd`.

## 6. Runtime-only data

The following data belongs in memory only:
- Current session ID and connection state.
- Active input ownership.
- Current pointer coordinates.
- Key/button states needed to release remote input safely.
- Clipboard payload currently being processed.
- Temporary transfer buffers.
- Pairing challenges and short-lived tokens.

Clear these values when the session ends. Never write raw input or clipboard data to persistent storage.

## 7. OS credential stores

### macOS
- Store private key material and trust credentials in Keychain.
- Use access controls appropriate to the signed application identity.
- Store only a non-secret credential reference in SQLite.

### Windows
- Use DPAPI and/or Windows Credential Manager.
- Scope secrets to the intended user/machine according to the security design.
- Store only a credential reference and public identity fingerprint in SQLite.

## 8. Data retention and deletion

- Transfer history is metadata-only.
- Provide a clear-history action.
- Provide a forget-device action that ends sessions, revokes trust and removes credential-store entries.
- Temporary partial files must be cleaned after cancellation/failure according to a documented retention policy.
- Do not retain clipboard history.
- Do not retain keyboard events.

## 9. Migration strategy

- Use sequential, immutable migration scripts.
- Apply migrations transactionally where possible.
- Record applied versions in `schema_migrations`.
- Back up or safely preserve user configuration before destructive migrations.
- Test upgrade from the previous released schema.
- Never silently drop trusted-device records or transfer history.

## 10. Example SQL baseline

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('macos', 'windows')),
    app_version TEXT,
    protocol_version INTEGER,
    last_known_address TEXT,
    last_seen_at TEXT,
    is_paired INTEGER NOT NULL DEFAULT 0 CHECK (is_paired IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trusted_device_credentials (
    device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
    credential_ref TEXT NOT NULL,
    identity_fingerprint TEXT NOT NULL,
    paired_at TEXT NOT NULL,
    last_verified_at TEXT,
    revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS device_layouts (
    layout_id TEXT PRIMARY KEY,
    local_device_id TEXT NOT NULL,
    remote_device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    local_display_id TEXT,
    remote_display_id TEXT,
    relative_position TEXT NOT NULL
        CHECK (relative_position IN ('left', 'right', 'top', 'bottom')),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_records (
    transfer_id TEXT PRIMARY KEY,
    peer_device_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
    direction TEXT NOT NULL CHECK (direction IN ('send', 'receive')),
    status TEXT NOT NULL,
    total_bytes INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
    transferred_bytes INTEGER NOT NULL DEFAULT 0 CHECK (transferred_bytes >= 0),
    started_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_items (
    item_id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL REFERENCES transfer_records(transfer_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    relative_path TEXT,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_paired ON devices(is_paired);
CREATE INDEX IF NOT EXISTS idx_transfers_created_at ON transfer_records(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_peer ON transfer_records(peer_device_id);
CREATE INDEX IF NOT EXISTS idx_transfer_items_transfer ON transfer_items(transfer_id);
```

## 11. Open schema decisions

- Whether each app uses exactly the same local schema or a platform-specific subset.
- Whether transfer resume metadata is stored in a separate table in P1.
- Whether device layouts need per-display coordinate calibration.
- Whether a local audit event table is needed; if added, it must not store sensitive content.
- Exact cleanup policy for abandoned partial transfers.
