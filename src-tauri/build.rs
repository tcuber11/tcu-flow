// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
fn main() {
    // the Android side of "let computers control this phone" (TcuflowPlugin.kt); no Rust commands of its own
    let tcuflow = tauri_build::InlinedPlugin::new()
        .commands(&["status", "openSettings", "askCode", "pairCode", "start", "cursor", "exemptBattery"])
        .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands);
    tauri_build::try_build(tauri_build::Attributes::new().plugin("tcuflow", tcuflow)).expect("tauri build");
    // screencapturekit links a Swift bridge; a dependency's link args don't reach this binary, so the Swift
    // runtime rpath is added here (the system one, then Xcode's toolchain for whatever the system lacks)
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        if let Ok(out) = std::process::Command::new("xcode-select").arg("-p").output() {
            let dev = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !dev.is_empty() {
                println!("cargo:rustc-link-arg=-Wl,-rpath,{dev}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx");
            }
        }
    }
}
