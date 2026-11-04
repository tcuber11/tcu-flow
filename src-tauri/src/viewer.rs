//! The viewer side of a remote screen (ADR-002), on every platform: the stream to a paired computer's screen
//! service, the viewer's input frames back, and the viewer's clipboard. Capturing and encoding are the shared
//! side's (`screen`, desktop only); the wire format is documented there.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

static NEXT: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Mutex<Option<HashMap<u64, mpsc::UnboundedSender<Vec<u8>>>>> = Mutex::new(None);

fn sessions() -> std::sync::MutexGuard<'static, Option<HashMap<u64, mpsc::UnboundedSender<Vec<u8>>>>> {
    let mut s = SESSIONS.lock().unwrap();
    if s.is_none() {
        *s = Some(HashMap::new());
    }
    s
}

/// Opens the stream to `fingerprint`'s screen; server bytes arrive on `on_data` as they come (the viewer
/// reassembles the framing), an empty message means the stream ended.
#[tauri::command]
pub async fn remote_open(app: AppHandle, fingerprint: String, on_data: Channel<InvokeResponseBody>) -> Result<u64, String> {
    let s = crate::open_service(&app, &fingerprint, crate::kvm::Service::Screen).await?;
    let (mut rd, mut wr) = tokio::io::split(s);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    sessions().as_mut().unwrap().insert(id, tx);
    tauri::async_runtime::spawn(async move {
        while let Some(f) = rx.recv().await {
            if wr.write_all(&f).await.is_err() {
                break;
            }
        }
        let _ = wr.shutdown().await;
    });
    tauri::async_runtime::spawn(async move {
        let mut buf = vec![0u8; 64 << 10];
        while let Ok(n @ 1..) = rd.read(&mut buf).await {
            if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                break;
            }
        }
        sessions().as_mut().unwrap().remove(&id);
        let _ = on_data.send(InvokeResponseBody::Raw(Vec::new()));
    });
    Ok(id)
}

/// A client input frame (see the module doc), sent as is.
#[tauri::command]
pub fn remote_input(id: u64, data: Vec<u8>) {
    if let Some(tx) = sessions().as_ref().unwrap().get(&id) {
        let _ = tx.send(data);
    }
}

/// The viewer window's own clipboard text (desktop): sent to the shared computer when it changes.
#[tauri::command]
pub fn remote_clipboard_get() -> Option<String> {
    crate::platform::clipboard_shared().then(crate::platform::clipboard_text).flatten()
}

/// Text copied on the shared computer, onto the viewer's clipboard.
#[tauri::command]
pub fn remote_clipboard_set(text: String) {
    if crate::platform::clipboard_shared() {
        crate::platform::set_clipboard_text(&text);
    }
}

#[tauri::command]
pub fn remote_close(id: u64) {
    sessions().as_mut().unwrap().remove(&id);
}

