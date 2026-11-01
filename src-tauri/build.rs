// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
fn main() {
    // the Android side of "let computers control this phone" (TcuflowPlugin.kt); no Rust commands of its own
    let tcuflow = tauri_build::InlinedPlugin::new()
        .commands(&["status", "openSettings", "askCode", "pairCode", "start", "cursor", "exemptBattery"])
        .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands);
    tauri_build::try_build(tauri_build::Attributes::new().plugin("tcuflow", tcuflow)).expect("tauri build");
}
