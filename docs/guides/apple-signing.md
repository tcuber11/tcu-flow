# Apple signing: notarized macOS builds and TestFlight for iOS

With the Apple Developer Program, CI (`.github/workflows/build.yml`) signs and notarizes the Mac app (no more
"Open Anyway") and uploads the iOS app to TestFlight. Everything below is done once; the secrets then drive every
build. Nothing here goes into the repository.

It also keeps macOS permissions across updates. An ad-hoc signed app is identified by the hash of that exact
build, so after every update Screen Recording and Accessibility still show TCuFlow switched on but no longer
count. A Developer ID signature is identified by team and bundle id instead: allowed once, allowed for good.

## 1. What to create at developer.apple.com

Certificates, Identifiers & Profiles:

1. **Identifier**: App ID `dev.tcuflow.app` (explicit), capabilities: none needed now. Later: *Multicast
   Networking* (request it via the form linked there; it lets the iPhone find computers by broadcast).
2. **Certificates** (create on this Mac in Xcode → Settings → Accounts → Manage Certificates, or on the site):
   - *Developer ID Application* — signs the Mac app for distribution outside the App Store.
   - *Apple Distribution* — signs the iOS app for TestFlight / App Store.
3. **Profile**: App Store Connect distribution profile for `dev.tcuflow.app` with the Apple Distribution
   certificate → download `tcuflow.mobileprovision`.

App Store Connect:

4. **App record**: My Apps → + → iOS, name TCuFlow, bundle id `dev.tcuflow.app`, SKU `tcuflow`.
5. **API key**: Users and Access → Integrations → App Store Connect API → Team keys → + , role *App Manager*.
   Note the **Issuer ID**, the **Key ID**, and download `AuthKey_<KEYID>.p8` (only downloadable once).

Team ID: `J24ATXQNJW` (Membership details; also the OU of every certificate).

## 2. Export the certificates

In Keychain Access → My Certificates: right-click *Developer ID Application: …* → Export → `.p12` with a
password. Same for *Apple Distribution: …*.

## 3. Repository secrets

`scripts/apple-secrets.sh` asks for the exported files (drag each into the terminal, Enter skips a part) and
sets every secret below; the Mac part alone is enough for a signed, permission-keeping Mac app. By hand:

```sh
cd ~/Documents/Project/tcu-flow
gh secret set APPLE_TEAM_ID            --body "J24ATXQNJW"
gh secret set APPLE_CERTIFICATE        < <(base64 -i developer-id.p12)
gh secret set APPLE_CERTIFICATE_PASSWORD   # asks for it; a password never goes on the command line
gh secret set APPLE_SIGNING_IDENTITY   --body "Developer ID Application: Widyo Tri Cahya Utomo (J24ATXQNJW)"
gh secret set APPLE_API_ISSUER         --body "<issuer id>"
gh secret set APPLE_API_KEY            --body "<key id>"
gh secret set APPLE_API_KEY_B64        < <(base64 -i AuthKey_<KEYID>.p8)
gh secret set IOS_CERTIFICATE          < <(base64 -i apple-distribution.p12)
gh secret set IOS_CERTIFICATE_PASSWORD     # asks for it
gh secret set IOS_PROVISIONING_PROFILE < <(base64 -i tcuflow.mobileprovision)
```

The exact signing identity string: `security find-identity -v -p codesigning` on the Mac that holds it.

## 4. What CI does with them

- **macOS job**: tauri imports the Developer ID certificate into a temporary keychain, signs the universal app
  with the hardened runtime, builds the dmg, and notarizes both through the API key (`APPLE_API_*`): on releases
  and manual runs only, since Apple can take 40 minutes; pushes are signed but not notarized. Without the
  secrets it falls back to the ad-hoc signature as before.
- **iOS job**: imports the distribution certificate and the profile, `tauri ios build --export-method
  app-store-connect`, uploads the `.ipa` with `altool`. The build appears in App Store Connect → TestFlight a
  few minutes later; add testers there (internal: up to 100 team members, external: up to 10 000 by link after
  a one-time review).

## 5. Local iOS runs on this Mac

Xcode handles signing itself for development: open `src-tauri/gen/apple/tcuflow.xcodeproj`, Signing &
Capabilities → Team, run on a plugged-in iPhone. `tauri.conf.json` carries the team id for `tauri ios dev`.

## Renewals

Certificates last a year (Developer ID: five), the profile a year, the API key does not expire. When one lapses
the job fails at signing: re-export and `gh secret set` again.
