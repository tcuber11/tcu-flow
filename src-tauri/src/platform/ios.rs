//! iOS: no input injection exists for apps, so the phone only drives (the touchpad, `TouchEngine`); what is
//! platform-specific here is the clipboard, through UIPasteboard as this app, and opening links.
use objc2::MainThreadMarker;
use objc2_foundation::{NSDictionary, NSString, NSURL};
use objc2_ui_kit::{UIApplication, UIDevice, UIPasteboard};

/// What other devices list this one as: the name in Settings › General › About where iOS hands it over, else
/// the kind ("iPhone", "iPad"; iOS 16+ gives apps only that without a special entitlement). Main thread.
pub fn device_name() -> Option<String> {
    let mtm = MainThreadMarker::new()?;
    Some(UIDevice::currentDevice(mtm).name().to_string()).filter(|n| !n.trim().is_empty())
}

/// Opens `url` in Safari (or the app that claims it). UIKit: main thread only.
pub fn open_url(url: &str) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("links open from the main thread")?;
    let url = NSURL::URLWithString(&NSString::from_str(url)).ok_or("not a link")?;
    // SAFETY: an empty options dictionary is of the type the method expects
    unsafe { UIApplication::sharedApplication(mtm).openURL_options_completionHandler(&url, &NSDictionary::new(), None) };
    Ok(())
}

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
