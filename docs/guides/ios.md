# TCuFlow on iPhone and iPad

**What it does there:** the touchpad that drives a linked computer, the clipboard (text, through UIPasteboard in `platform/ios.rs`), and sending files. **What it
can't do:** be driven. iOS lets no app move the cursor or type into other apps, so a computer's cursor never
moves onto an iPhone. Android gets that through its Wireless-debugging injector; iOS has no equivalent.

**Discovery caveat:** iOS only allows UDP broadcast/multicast to apps Apple has granted the
`com.apple.developer.networking.multicast` entitlement (requested through Apple's form, free, takes days).
Until then the iPhone may not list computers by itself: use **Add by IP** with the address shown under
"This computer's address" on the computer. Unicast works without the entitlement.

## Project

`src-tauri/gen/apple/` is the Xcode project (`tauri ios init`), bundle id `dev.tcuflow.app`, iOS 13+.
The Rust crate builds for `aarch64-apple-ios` and `aarch64-apple-ios-sim` (Linux-only and desktop-only
modules are gated out; `mac_address` has no iOS backend, so Wake-on-LAN sends none).

## Run it

Needs Xcode 15+, CocoaPods (`brew install cocoapods`) and the Rust targets
(`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`).

- Simulator (no Apple account): `npx tauri ios dev` and pick a simulator, or open
  `src-tauri/gen/apple/tcuflow.xcodeproj` in Xcode and run `tcuflow_iOS`.
- Your own iPhone with a **free Apple ID**: in Xcode, Signing & Capabilities → Team: your Apple ID (Personal
  Team). The app runs 7 days, then needs reinstalling. Three apps per device.
- Other people: TestFlight (up to 10 000 testers, builds last 90 days) or the App Store, through the team's
  Apple Developer Program (team `J24ATXQNJW`, set in `tauri.conf.json`). CI uploads every build to TestFlight
  once the secrets in [apple-signing.md](apple-signing.md) are set; by hand: `npx tauri ios build
  --export-method app-store-connect` and upload the `.ipa` with Transporter.

## Not done yet

- Background: iOS suspends the app when it leaves the screen, so the link drops until it comes back; the
  touchpad only works with TCuFlow in front.
- The multicast entitlement request (developer.apple.com → Identifiers → dev.tcuflow.app → Multicast Networking → request).
