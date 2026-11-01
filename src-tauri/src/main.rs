// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tcuflow_lib::run()
}
