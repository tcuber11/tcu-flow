#!/bin/sh
# Sets the GitHub secrets .github/workflows/build.yml signs with (docs/guides/apple-signing.md). Run it from the
# repository on the Mac that holds the certificates. It asks for each file (drag it into the terminal) and skips
# a part when you just press Enter. Values go to `gh secret set` through stdin, never onto a command line or disk.
set -eu
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo "Needs the GitHub CLI: brew install gh, then gh auth login"; exit 1; }

TEAM=J24ATXQNJW

ask() { printf '%s: ' "$1" >&2; read -r v; printf '%s' "$v"; }
# IFS= keeps a password's leading or trailing spaces; echo comes back even after Ctrl-C
secret_ask() { printf '%s: ' "$1" >&2; stty -echo; IFS= read -r v; stty echo; echo >&2; printf '%s' "$v"; }
trap 'stty echo 2>/dev/null' EXIT INT TERM
# a dragged-in path: quotes or backslash escapes around it, maybe ~
path() {
  p=$(printf '%s' "$1" | sed -e "s/^ *['\"]//" -e "s/['\"] *$//" -e 's/\\\(.\)/\1/g' -e 's/ *$//')
  case $p in "~/"*) p="$HOME/${p#\~/}" ;; esac
  [ -z "$p" ] || [ -f "$p" ] || { echo "No such file: $p" >&2; exit 1; }
  printf '%s' "$p"
}
set_value() { printf '%s' "$2" | gh secret set "$1" && echo "  set $1"; }
set_file() { base64 -i "$2" | tr -d '\n' | gh secret set "$1" && echo "  set $1"; }

echo "1/3  Mac app: Developer ID Application certificate"
p12=$(path "$(ask "  .p12 file (Enter to skip)")")
if [ -n "$p12" ]; then
  identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
  [ -n "$identity" ] || identity=$(ask "  Signing identity (Developer ID Application: Name (TEAM))")
  echo "  identity: $identity"
  pw=$(secret_ask "  .p12 password")
  set_value APPLE_TEAM_ID "$TEAM"
  set_file APPLE_CERTIFICATE "$p12"
  set_value APPLE_CERTIFICATE_PASSWORD "$pw"
  set_value APPLE_SIGNING_IDENTITY "$identity"
fi

echo "2/3  App Store Connect API key (notarization, TestFlight)"
p8=$(path "$(ask "  AuthKey_XXXXXXXXXX.p8 file (Enter to skip)")")
if [ -n "$p8" ]; then
  key=$(basename "$p8" | sed -n 's/^AuthKey_\([A-Z0-9]*\)\.p8$/\1/p')
  [ -n "$key" ] || key=$(ask "  Key ID")
  issuer=$(ask "  Issuer ID (the long id above the keys list)")
  set_file APPLE_API_KEY_B64 "$p8"
  set_value APPLE_API_KEY "$key"
  set_value APPLE_API_ISSUER "$issuer"
fi

echo "3/3  iPhone/iPad: Apple Distribution certificate + App Store profile (TestFlight)"
ios=$(path "$(ask "  Apple Distribution .p12 file (Enter to skip)")")
if [ -n "$ios" ]; then
  profile=$(path "$(ask "  .mobileprovision file")")
  pw=$(secret_ask "  .p12 password")
  set_value APPLE_TEAM_ID "$TEAM"
  set_file IOS_CERTIFICATE "$ios"
  set_value IOS_CERTIFICATE_PASSWORD "$pw"
  set_file IOS_PROVISIONING_PROFILE "$profile"
fi

echo
gh secret list
