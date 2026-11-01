//! Remote screen: a paired device's primary display streamed over the pinned link, with the viewer's mouse
//! and keyboard sent back and injected there. Opt-in on the shared side ("Share my screen"), refused
//! otherwise like every service. First slice: JPEG frames at up to 20 fps, downscaled to 1600 px wide;
//! a hardware video codec can replace the encoder without touching the wire framing.
//!
//! Wire after the service handshake (little-endian):
//! - server → client: `tag: u8 | len: u32 | len bytes`. Tag 1: a JPEG frame. Tag 2: info, `w: u32, h: u32`,
//!   the shared display in physical pixels. Tag 3: UTF-8 error text, after which the stream closes.
//! - client → server: fixed 9-byte frames `tag: u8 | 8 payload bytes`: 1 move `nx: f32, ny: f32` (0..1 of the
//!   shared display), 2 button `button: u8, down: u8` (1 left, 2 right, 3 middle), 3 wheel `dx: i32, dy: i32`
//!   (120 per notch, up is positive), 4 key `scan: u16, down: u8` (set-1 scancode); 5 text `len: u32` then
//!   `len` bytes of UTF-8 typed at the cursor.
//! Any malformed client frame ends the session, and so does the viewer going away: the capture stops with it.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::network::secure::Stream;
use crate::platform::{Injected, Rect, SpatialPlatformEngine};

const FRAME: u8 = 1;
const INFO: u8 = 2;
const ERROR: u8 = 3;
/// frames are downscaled to at most this wide
const MAX_WIDTH: u32 = 1600;
const QUALITY: u8 = 70;
const MIN_INTERVAL: Duration = Duration::from_millis(50);

/// A captured frame, tightly packed RGB.
pub struct Rgb {
    pub w: u32,
    pub h: u32,
    pub data: Vec<u8>,
}

/// Latest-frame slot between the capture callback and the encoder: the newest frame replaces an unencoded one.
#[derive(Default)]
struct Slot {
    frame: Mutex<Option<Rgb>>,
    ready: Condvar,
}

impl Slot {
    fn put(&self, rgb: Rgb) {
        *self.frame.lock().unwrap() = Some(rgb);
        self.ready.notify_one();
    }

    /// The next frame, or `None` after `wait` without one.
    fn take(&self, wait: Duration) -> Option<Rgb> {
        let guard = self.frame.lock().unwrap();
        let (mut guard, _) = self.ready.wait_timeout_while(guard, wait, |f| f.is_none()).unwrap();
        guard.take()
    }
}

/// Pack a captured BGRA/RGBA frame into RGB, downscaled by whole-pixel box averaging to at most
/// `MAX_WIDTH` wide. `stride` is the source row length in bytes.
pub fn pack(src: &[u8], w: u32, h: u32, stride: usize, bgra: bool) -> Rgb {
    let f = w.div_ceil(MAX_WIDTH).max(1);
    let (ow, oh) = (w / f, h / f);
    let (r, b) = if bgra { (2usize, 0usize) } else { (0, 2) };
    let mut data = Vec::with_capacity((ow * oh * 3) as usize);
    let n = (f * f) as u32;
    for oy in 0..oh {
        for ox in 0..ow {
            let (mut sr, mut sg, mut sb) = (0u32, 0u32, 0u32);
            for dy in 0..f {
                let row = ((oy * f + dy) as usize) * stride;
                for dx in 0..f {
                    let p = row + ((ox * f + dx) as usize) * 4;
                    sr += src[p + r] as u32;
                    sg += src[p + 1] as u32;
                    sb += src[p + b] as u32;
                }
            }
            data.extend_from_slice(&[(sr / n) as u8, (sg / n) as u8, (sb / n) as u8]);
        }
    }
    Rgb { w: ow, h: oh, data }
}

/// Cheap fingerprint of a frame, to skip resending an unchanged screen.
fn fingerprint(rgb: &Rgb) -> u64 {
    let mut h = 0xcbf29ce484222325u64;
    for &b in rgb.data.iter().step_by(97) {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    h ^ ((rgb.w as u64) << 32 | rgb.h as u64)
}

fn encode(rgb: &Rgb) -> io::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(256 << 10);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, QUALITY)
        .encode(&rgb.data, rgb.w, rgb.h, image::ExtendedColorType::Rgb8)
        .map_err(io::Error::other)?;
    Ok(out)
}

/// A running capture of the primary display; dropping it stops the capture.
struct Capture {
    stop: Arc<AtomicBool>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Starts capturing the primary display into `slot` on its own thread. Resolves once the OS accepted
/// (frames follow) or refused (permission, no display).
fn start_capture(slot: Arc<Slot>) -> Result<Capture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let s = stop.clone();
    std::thread::Builder::new()
        .name("tcuflow-screen".into())
        .spawn(move || cap::run(slot, s, tx))
        .map_err(|e| e.to_string())?;
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(Capture { stop }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("screen capture didn't start in time".into()),
    }
}

/// The shared side. `screens`: this computer's displays in physical pixels; the primary one is streamed and
/// the viewer's positions land on it.
pub async fn serve(stream: Stream, engine: Arc<dyn SpatialPlatformEngine>, screens: Vec<Rect>) -> io::Result<()> {
    let (mut rd, mut wr) = tokio::io::split(stream);
    let Some(display) = screens.iter().find(|r| r.x == 0.0 && r.y == 0.0).or(screens.first()).copied() else {
        return say(&mut wr, ERROR, b"no display to share").await;
    };
    let slot = Arc::new(Slot::default());
    let capture = match start_capture(slot.clone()) {
        Ok(c) => c,
        Err(e) => {
            journal!("screen share refused: {e}");
            return say(&mut wr, ERROR, e.as_bytes()).await;
        }
    };
    let mut info = (display.w as u32).to_le_bytes().to_vec();
    info.extend_from_slice(&(display.h as u32).to_le_bytes());
    say(&mut wr, INFO, &info).await?;

    // encoder thread → bounded queue → writer; a full queue drops the frame (the next one is newer anyway)
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(2);
    let encoding = Arc::new(AtomicBool::new(true));
    let (slot2, enc2) = (slot.clone(), encoding.clone());
    std::thread::Builder::new()
        .name("tcuflow-encode".into())
        .spawn(move || {
            let mut last = 0u64;
            while enc2.load(Ordering::Relaxed) {
                let Some(rgb) = slot2.take(Duration::from_millis(500)) else { continue };
                let fp = fingerprint(&rgb);
                if fp == last {
                    continue;
                }
                match encode(&rgb) {
                    Ok(jpeg) => {
                        last = fp;
                        let _ = tx.try_send(jpeg);
                    }
                    Err(e) => journal!("screen encode: {e}"),
                }
            }
        })
        .map_err(io::Error::other)?;
    let writer = async move {
        while let Some(jpeg) = rx.recv().await {
            say(&mut wr, FRAME, &jpeg).await?;
        }
        Ok::<(), io::Error>(())
    };
    // the viewer's input, injected on this computer
    let reader = async move {
        let mut b = [0u8; 9];
        loop {
            rd.read_exact(&mut b).await?;
            let event = match b[0] {
                1 => {
                    let nx = f32::from_le_bytes(b[1..5].try_into().unwrap()).clamp(0.0, 1.0) as f64;
                    let ny = f32::from_le_bytes(b[5..9].try_into().unwrap()).clamp(0.0, 1.0) as f64;
                    Injected::MoveTo { x: display.x + nx * display.w, y: display.y + ny * display.h }
                }
                2 if (1..=3).contains(&b[1]) => Injected::Button { button: b[1], down: b[2] != 0 },
                3 => Injected::Wheel { dx: i32::from_le_bytes(b[1..5].try_into().unwrap()), dy: i32::from_le_bytes(b[5..9].try_into().unwrap()) },
                4 => Injected::Key { scan: u16::from_le_bytes([b[1], b[2]]), down: b[3] != 0 },
                5 => {
                    let len = u32::from_le_bytes(b[1..5].try_into().unwrap());
                    if len > 4096 {
                        return Err(io::Error::new(io::ErrorKind::InvalidData, "text too long"));
                    }
                    let mut text = vec![0u8; len as usize];
                    rd.read_exact(&mut text).await?;
                    Injected::Text { text: String::from_utf8_lossy(&text).into_owned() }
                }
                _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "bad input frame")),
            };
            engine.inject(event);
        }
    };
    let r = tokio::select! {
        r = writer => r,
        r = reader => r,
    };
    encoding.store(false, Ordering::Relaxed);
    drop(capture);
    r
}

async fn say(wr: &mut (impl AsyncWriteExt + Unpin), tag: u8, body: &[u8]) -> io::Result<()> {
    wr.write_all(&[tag]).await?;
    wr.write_all(&(body.len() as u32).to_le_bytes()).await?;
    wr.write_all(body).await?;
    wr.flush().await
}

// ---- the viewer side (Tauri commands) ------------------------------------------------------------

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

#[tauri::command]
pub fn remote_close(id: u64) {
    sessions().as_mut().unwrap().remove(&id);
}

/// The viewer window for paired device `fingerprint`, one per device, focused if it is already open.
#[tauri::command]
pub fn open_remote_window(app: AppHandle, fingerprint: String, alias: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let label = format!("remote-{}", fingerprint.chars().take(16).collect::<String>());
    if let Some(w) = app.get_webview_window(&label) {
        return w.set_focus().map_err(|e| e.to_string());
    }
    let url = format!("index.html?remote={}&alias={}", urlencoding::encode(&fingerprint), urlencoding::encode(&alias));
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(format!("{alias} — TCuFlow"))
        .inner_size(1280.0, 840.0)
        .min_inner_size(640.0, 420.0)
        .build()
        .map(drop)
        .map_err(|e| e.to_string())
}

// ---- capture per OS ------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod cap {
    use super::*;
    use screencapturekit::cm::CMSampleBufferExt;
    use screencapturekit::cv::CVPixelBufferLockFlags;
    use screencapturekit::prelude::*;

    struct Handler(Arc<Slot>);

    impl SCStreamOutputTrait for Handler {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
            if !matches!(of_type, SCStreamOutputType::Screen) {
                return;
            }
            // idle frames (nothing changed) carry no pixel buffer
            let Some(pb) = sample.pixel_buffer() else { return };
            let Ok(guard) = pb.lock(CVPixelBufferLockFlags::READ_ONLY) else { return };
            let (w, h, stride) = (guard.width() as u32, guard.height() as u32, guard.bytes_per_row());
            let Some(bytes) = (unsafe { guard.as_slice() }) else { return };
            if w == 0 || h == 0 || bytes.len() < stride * h as usize {
                return;
            }
            self.0.put(pack(bytes, w, h, stride, true));
        }
    }

    /// Needs Screen Recording permission; macOS prompts on the first call and refuses until granted.
    pub fn run(slot: Arc<Slot>, stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>) {
        let explain = |e: SCError| format!("this Mac hasn't allowed TCuFlow to record the screen: System Settings → Privacy & Security → Screen & System Audio Recording ({e})");
        let result = (|| {
            let content = SCShareableContent::get().map_err(explain)?;
            let display = content.displays().into_iter().next().ok_or("no display to share")?;
            let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build().map_err(|e| e.to_string())?;
            // display dims are points; the output is at most MAX_WIDTH wide, SCK scales
            let (pw, ph) = (display.width().max(1), display.height().max(1));
            let ow = pw.min(MAX_WIDTH);
            let oh = (ow as u64 * ph as u64 / pw as u64) as u32;
            let config = SCStreamConfiguration::new()
                .with_width(ow)
                .with_height(oh)
                .with_scales_to_fit(true)
                .with_pixel_format(PixelFormat::BGRA)
                .with_shows_cursor(true)
                .with_queue_depth(3)
                .with_minimum_frame_interval(&CMTime::new(MIN_INTERVAL.as_millis() as i64, 1000));
            let mut stream = SCStream::new(&filter, &config).map_err(|e| e.to_string())?;
            stream.add_output_handler(Handler(slot), SCStreamOutputType::Screen).map_err(|e| e.to_string())?;
            stream.start_capture().map_err(|e| e.to_string())?;
            Ok::<SCStream, String>(stream)
        })();
        let stream = match result {
            Ok(s) => {
                let _ = started.send(Ok(()));
                s
            }
            Err(e) => {
                let _ = started.send(Err(e));
                return;
            }
        };
        while !stop.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = stream.stop_capture();
    }
}

#[cfg(target_os = "windows")]
mod cap {
    use super::*;
    use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings};

    struct Handler {
        slot: Arc<Slot>,
        stop: Arc<AtomicBool>,
        started: Option<std::sync::mpsc::Sender<Result<(), String>>>,
        scratch: Vec<u8>,
    }

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = (Arc<Slot>, Arc<AtomicBool>, std::sync::mpsc::Sender<Result<(), String>>);
        type Error = Box<dyn std::error::Error + Send + Sync>;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            let (slot, stop, started) = ctx.flags;
            Ok(Self { slot, stop, started: Some(started), scratch: Vec::new() })
        }

        fn on_frame_arrived(&mut self, frame: &mut Frame, control: InternalCaptureControl) -> Result<(), Self::Error> {
            if let Some(tx) = self.started.take() {
                let _ = tx.send(Ok(()));
            }
            if self.stop.load(Ordering::SeqCst) {
                control.stop();
                return Ok(());
            }
            let (w, h) = (frame.width(), frame.height());
            let buffer = frame.buffer()?;
            let bytes = buffer.as_nopadding_buffer(&mut self.scratch);
            if w > 0 && h > 0 && bytes.len() >= (w * h * 4) as usize {
                self.slot.put(pack(bytes, w, h, (w * 4) as usize, false));
            }
            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            self.stop.store(true, Ordering::SeqCst);
            Ok(())
        }
    }

    /// Windows Graphics Capture of the primary monitor; no permission prompt, but the secure desktop
    /// (UAC, lock screen) is never captured.
    pub fn run(slot: Arc<Slot>, stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>) {
        let monitor = match Monitor::primary() {
            Ok(m) => m,
            Err(e) => {
                let _ = started.send(Err(format!("no primary monitor: {e}")));
                return;
            }
        };
        let settings = Settings::new(
            monitor,
            CursorCaptureSettings::WithCursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Custom(MIN_INTERVAL),
            DirtyRegionSettings::Default,
            ColorFormat::Rgba8,
            (slot, stop, started.clone()),
        );
        // blocks until `stop`; a failure to start comes back here, before any frame
        if let Err(e) = Handler::start(settings) {
            let _ = started.send(Err(format!("screen capture failed: {e}")));
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod cap {
    use super::*;
    pub fn run(_slot: Arc<Slot>, _stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>) {
        let _ = started.send(Err("screen sharing isn't available on this device".into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pack_converts_bgra_and_downscales_by_whole_pixels() {
        // 2x1 BGRA image, stride with padding
        let src = [10u8, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0];
        let rgb = pack(&src, 2, 1, 12, true);
        assert_eq!((rgb.w, rgb.h), (2, 1));
        assert_eq!(rgb.data, vec![30, 20, 10, 60, 50, 40]);
        // 4000 px wide → factor 3 → 1333 wide, each output pixel the mean of a 3x3 block
        let w = 4000u32;
        let src = vec![100u8; (w * 3 * 4) as usize];
        let rgb = pack(&src, w, 3, (w * 4) as usize, false);
        assert_eq!((rgb.w, rgb.h), (1333, 1));
        assert!(rgb.data.iter().all(|&b| b == 100));
    }

    #[test]
    fn unchanged_frames_share_a_fingerprint_and_encode_as_jpeg() {
        let a = Rgb { w: 8, h: 8, data: vec![200; 8 * 8 * 3] };
        let b = Rgb { w: 8, h: 8, data: vec![200; 8 * 8 * 3] };
        let mut c = Rgb { w: 8, h: 8, data: vec![200; 8 * 8 * 3] };
        c.data[0] = 0;
        assert_eq!(fingerprint(&a), fingerprint(&b));
        assert_ne!(fingerprint(&a), fingerprint(&c));
        let jpeg = encode(&a).unwrap();
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "JPEG SOI");
    }

    /// Real capture of this computer's primary display over a loopback QUIC link: `cargo test --lib
    /// screen::tests::streams_this_screen -- --ignored --nocapture`. Needs Screen Recording permission for
    /// the test host; without it the server's refusal text comes back instead of a frame. On macOS,
    /// ScreenCaptureKit's content query waits on the main run loop, which a test binary has none of, so it
    /// may time out here while working in the app (`npm run sim` → View screen on the simulated phone).
    #[tokio::test]
    #[ignore]
    async fn streams_this_screen_over_loopback() {
        tokio::time::timeout(Duration::from_secs(40), streams_this_screen()).await.expect("capture didn't start: no run loop or no permission");
    }

    async fn streams_this_screen() {
        use crate::network::secure::{Identity, Tls};
        let (them, me) = (Arc::new(Tls::new(&Identity::generate())), Tls::new(&Identity::generate()));
        let fp = them.me.clone();
        let port = 53377;
        let server = them.clone();
        tokio::spawn(async move {
            let mut l = server.listen(port).unwrap();
            let (stream, _, _) = l.accept().await.unwrap();
            let engine: Arc<dyn SpatialPlatformEngine> = Arc::from(crate::platform::engine());
            let screens = vec![Rect { x: 0.0, y: 0.0, w: 3024.0, h: 1964.0 }];
            let _ = serve(stream, engine, screens).await;
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        let (mut s, _) = me.connect(([127, 0, 0, 1], port).into(), Some(&fp)).await.unwrap();
        let mut seen = Vec::new();
        let started = std::time::Instant::now();
        while seen.len() < 3 && started.elapsed() < Duration::from_secs(20) {
            let tag = s.read_u8().await.unwrap();
            let len = s.read_u32_le().await.unwrap();
            let mut body = vec![0u8; len as usize];
            s.read_exact(&mut body).await.unwrap();
            match tag {
                INFO => println!("info: {}x{}", u32::from_le_bytes(body[..4].try_into().unwrap()), u32::from_le_bytes(body[4..8].try_into().unwrap())),
                FRAME => {
                    assert_eq!(&body[..2], &[0xFF, 0xD8]);
                    println!("frame: {} bytes after {:?}", body.len(), started.elapsed());
                }
                ERROR => {
                    println!("refused: {}", String::from_utf8_lossy(&body));
                    return;
                }
                _ => panic!("bad tag {tag}"),
            }
            seen.push(tag);
        }
        assert!(seen.contains(&FRAME), "no frame arrived: {seen:?}");
    }

    #[test]
    fn slot_keeps_only_the_newest_frame() {
        let slot = Slot::default();
        slot.put(Rgb { w: 1, h: 1, data: vec![1, 1, 1] });
        slot.put(Rgb { w: 1, h: 1, data: vec![2, 2, 2] });
        assert_eq!(slot.take(Duration::from_millis(10)).unwrap().data, vec![2, 2, 2]);
        assert!(slot.take(Duration::from_millis(10)).is_none());
    }
}
