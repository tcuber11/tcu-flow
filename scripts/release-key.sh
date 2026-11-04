#!/bin/sh
# Once: the GPG key that signs each release's SHA256SUMS (scripts/checksums.mjs). Its passphrase is random and
# lives next to the updater key in ~/.tauri (never commit either); the public half goes to the site, where anyone
# can fetch it: site/tcuflow-release-key.asc → https://tcuber11.github.io/tcu-flow/tcuflow-release-key.asc
set -eu
cd "$(dirname "$0")/.."
command -v gpg >/dev/null || { echo "Needs GnuPG: brew install gnupg"; exit 1; }

UID_NAME="TCuFlow releases"
PASS="$HOME/.tauri/tcuflow-gpg.password"

if gpg --list-secret-keys "$UID_NAME" >/dev/null 2>&1; then
  echo "A \"$UID_NAME\" key exists already:"
else
  mkdir -p "$HOME/.tauri"
  umask 077
  [ -f "$PASS" ] || openssl rand -base64 32 | tr -d '\n' > "$PASS"
  gpg --batch --pinentry-mode loopback --passphrase-file "$PASS" --quick-gen-key "$UID_NAME" ed25519 sign 3y
  echo "Created:"
fi
gpg --list-keys --with-subkey-fingerprints "$UID_NAME" | sed -n '1,4p'
gpg --armor --export "$UID_NAME" > site/tcuflow-release-key.asc
echo "Public key: site/tcuflow-release-key.asc (commit it). Back up ~/.gnupg and $PASS with the other keys."
