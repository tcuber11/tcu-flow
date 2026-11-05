# Homebrew cask, read from this repository as a tap:
#   brew tap tcuber11/tcuflow https://github.com/tcuber11/tcu-flow
#   brew trust --tap tcuber11/tcuflow     (Homebrew 7 loads third-party taps only once trusted)
#   brew install --cask tcuflow
# scripts/release.mjs sets version and sha256 on every release.
cask "tcuflow" do
  version "0.9.13"
  sha256 "11a00cc7a8586d36767ade241a9be8ed18fffbc1d47367d73bca9025b69f9c33"

  url "https://github.com/tcuber11/tcu-flow/releases/download/v#{version}/TCuFlow_#{version}_universal.dmg"
  name "TCuFlow"
  desc "Share one mouse, keyboard and clipboard between computers on a network"
  homepage "https://tcuber11.github.io/tcu-flow/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # updates itself from inside the app
  auto_updates true
  # ScreenCaptureKit, for the remote screen
  depends_on macos: :monterey

  app "TCuFlow.app"

  zap trash: [
    "~/Library/Application Support/dev.tcuflow.app",
    "~/Library/Caches/dev.tcuflow.app",
    "~/Library/Preferences/dev.tcuflow.app.plist",
    "~/Library/Saved Application State/dev.tcuflow.app.savedState",
    "~/Library/WebKit/dev.tcuflow.app",
  ]
end
