//! iOS: no input injection exists for apps, so the phone only drives (the touchpad, `TouchEngine`); what is
//! platform-specific here is the clipboard, through UIPasteboard as this app.
use objc2_foundation::NSString;
use objc2_ui_kit::UIPasteboard;

/// The general pasteboard's text; `None` when empty or not text.
pub fn clipboard_text() -> Option<String> {
    let pb = unsafe { UIPasteboard::generalPasteboard() };
    let s = unsafe { pb.string() }?;
    Some(s.to_string())
}

pub fn set_clipboard_text(text: &str) {
    let pb = unsafe { UIPasteboard::generalPasteboard() };
    unsafe { pb.setString(Some(&NSString::from_str(text))) };
}
