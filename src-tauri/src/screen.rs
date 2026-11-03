//! Remote screen: a paired device's primary display streamed over the pinned link, with the viewer's mouse
//! and keyboard sent back and injected there. Opt-in on the shared side ("Share my screen"), refused
//! otherwise like every service. Frames are downscaled to at most 1600 px wide and sent at up to 20 fps:
//! as H.264 (OpenH264, screen-content mode, ~3 Mbit/s) once the viewer says it can decode video (its
//! webview's WebCodecs), as JPEG until then and for a viewer that can't. Hardware encoders can replace
//! OpenH264 behind `H264` without touching the wire.
//!
//! Wire after the service handshake (little-endian):
//! - server → client: `tag: u8 | len: u32 | len bytes`. Tag 1: a JPEG frame. Tag 2: info, `w: u32, h: u32`
//!   of the shown display in physical pixels, then `shown: u8, n: u8` and `n` × `w: u32, h: u32, primary: u8`
//!   (every display, for a picker); sent again when the shown display changes. Tag 3: UTF-8 error text, after
//!   which the stream closes. Tag 5: clipboard text copied on the shared computer while it is viewed (UTF-8,
//!   ≤ 1 MiB), for the viewer's clipboard. Tag 4: an
//!   H.264 access unit, `key: u8 | w: u16 | h: u16 | Annex B NAL units` (SPS/PPS ride along with every key frame).
//! - client → server: fixed 9-byte frames `tag: u8 | 8 payload bytes`: 1 move `nx: f32, ny: f32` (0..1 of the
//!   shared display), 2 button `button: u8, down: u8` (1 left, 2 right, 3 middle), 3 wheel `dx: i32, dy: i32`
//!   (120 per notch, up is positive), 4 key `scan: u16, down: u8` (set-1 scancode); 5 text `len: u32` then
//!   `len` bytes of UTF-8 typed at the cursor; 6 codec `video: u8` (1: send H.264, 0: back to JPEG); 7 display
//!   `index: u8` into the info list: show that one instead; 8 clipboard `len: u32` then `len` bytes of UTF-8
//!   copied on the viewer, for the shared computer's clipboard. Both directions obey "Its clipboard" there.
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
const VIDEO: u8 = 4;
const CLIP: u8 = 5;
/// clipboard text either way is capped here, like the edge session's
const MAX_CLIP: usize = 1 << 20;
/// H.264 target bit rate; screen content at 1600 px wide looks clean here and sits well below a Wi-Fi link
const BITRATE: u32 = 3_000_000;
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
    // even sizes: H.264 works in 2×2 chroma blocks
    let (ow, oh) = ((w / f) & !1, (h / f) & !1);
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

/// The H.264 encoder for one stream, remade when the frame size changes.
struct H264 {
    enc: openh264::encoder::Encoder,
    yuv: openh264::formats::YUVBuffer,
    w: u32,
    h: u32,
    started: std::time::Instant,
}

impl H264 {
    fn new(w: u32, h: u32) -> io::Result<Self> {
        use openh264::encoder::{BitRate, EncoderConfig, FrameRate, RateControlMode, UsageType};
        let config = EncoderConfig::new()
            .usage_type(UsageType::ScreenContentRealTime)
            .rate_control_mode(RateControlMode::Bitrate)
            .bitrate(BitRate::from_bps(BITRATE))
            .max_frame_rate(FrameRate::from_hz(1000.0 / MIN_INTERVAL.as_millis() as f32))
            .skip_frames(false);
        let enc = openh264::encoder::Encoder::with_api_config(openh264::OpenH264API::from_source(), config).map_err(io::Error::other)?;
        Ok(Self { enc, yuv: openh264::formats::YUVBuffer::new(w as usize, h as usize), w, h, started: std::time::Instant::now() })
    }

    /// `(key frame?, Annex B bytes)`, or `None` when the encoder skipped the frame.
    fn encode(&mut self, rgb: &Rgb) -> io::Result<Option<(bool, Vec<u8>)>> {
        use openh264::encoder::FrameType;
        self.yuv.read_rgb8(openh264::formats::RgbSliceU8::new(&rgb.data, (rgb.w as usize, rgb.h as usize)));
        let at = openh264::Timestamp::from_millis(self.started.elapsed().as_millis() as u64);
        let out = self.enc.encode_at(&self.yuv, at).map_err(io::Error::other)?;
        let key = match out.frame_type() {
            FrameType::Skip | FrameType::Invalid => return Ok(None),
            FrameType::IDR | FrameType::I => true,
            _ => false,
        };
        let mut body = vec![key as u8];
        body.extend_from_slice(&(rgb.w as u16).to_le_bytes());
        body.extend_from_slice(&(rgb.h as u16).to_le_bytes());
        out.write_vec(&mut body);
        Ok(Some((key, body)))
    }
}

/// "Share my screen" turned off: every stream ends, viewers see the share stop.
static END: tokio::sync::Notify = tokio::sync::Notify::const_new();

pub fn stop_sharing() {
    END.notify_waiters();
}

/// One display as the capture backend lists them: where it sits in physical pixels (the viewer's positions
/// map onto it) and whether it is the main one (shown first).
#[derive(Clone, Copy, Debug)]
pub struct Display {
    pub rect: Rect,
    pub primary: bool,
}

/// Tag 2: the shown display's size, which one it is, and every display's size.
fn info_body(displays: &[Display], shown: usize) -> Vec<u8> {
    let d = &displays[shown].rect;
    let mut b = (d.w as u32).to_le_bytes().to_vec();
    b.extend_from_slice(&(d.h as u32).to_le_bytes());
    b.push(shown as u8);
    b.push(displays.len().min(255) as u8);
    for d in displays.iter().take(255) {
        b.extend_from_slice(&(d.rect.w as u32).to_le_bytes());
        b.extend_from_slice(&(d.rect.h as u32).to_le_bytes());
        b.push(d.primary as u8);
    }
    b
}

/// A running capture of one display; dropping it stops the capture.
struct Capture {
    stop: Arc<AtomicBool>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Starts capturing display `index` (of `cap::displays()`) into `slot` on its own thread. Resolves once
/// the OS accepted (frames follow) or refused (permission, no display).
fn start_capture(slot: Arc<Slot>, index: usize) -> Result<Capture, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let s = stop.clone();
    std::thread::Builder::new()
        .name("tcuflow-screen".into())
        .spawn(move || cap::run(slot, s, tx, index))
        .map_err(|e| e.to_string())?;
    match rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(Capture { stop }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("screen capture didn't start in time".into()),
    }
}

/// `tcuflow --screen-probe`: captures this computer's primary display for a few seconds and reports what
/// came, with no window and no network. The one check of the capture path that runs outside the app:
/// `cargo test` can't, because ScreenCaptureKit answers on the main run loop, which this pumps itself.
/// Exit 0 with frame stats on stdout, 1 with the refusal (permission, no display, no frames).
pub fn probe() -> ! {
    let slot = Arc::new(Slot::default());
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let stop = Arc::new(AtomicBool::new(false));
    let (s2, sl2) = (stop.clone(), slot.clone());
    std::thread::spawn(move || cap::run(sl2, s2, tx, 0));
    let t0 = std::time::Instant::now();
    let deadline = t0 + Duration::from_secs(12);
    let (mut started, mut frames, mut bytes, mut unchanged) = (false, 0u32, 0usize, 0u32);
    let mut last_fp = 0u64;
    let mut dims = (0u32, 0u32);
    while std::time::Instant::now() < deadline && frames < 40 {
        pump_main_run_loop(Duration::from_millis(20));
        if !started {
            match rx.try_recv() {
                Ok(Ok(())) => {
                    started = true;
                    println!("capture started after {} ms", t0.elapsed().as_millis());
                }
                Ok(Err(e)) => {
                    println!("refused: {e}");
                    std::process::exit(1);
                }
                Err(_) => {}
            }
        }
        if let Some(rgb) = slot.take(Duration::from_millis(5)) {
            let fp = fingerprint(&rgb);
            if fp == last_fp {
                unchanged += 1;
                continue;
            }
            last_fp = fp;
            match encode(&rgb) {
                Ok(jpeg) => {
                    frames += 1;
                    bytes += jpeg.len();
                    dims = (rgb.w, rgb.h);
                    if frames == 1 {
                        println!("first frame {}x{} ({} KB jpeg) after {} ms", rgb.w, rgb.h, jpeg.len() / 1024, t0.elapsed().as_millis());
                    }
                }
                Err(e) => {
                    println!("encode failed: {e}");
                    std::process::exit(1);
                }
            }
        }
    }
    stop.store(true, Ordering::SeqCst);
    if !started {
        println!("capture didn't start within {} s (no permission prompt answered, or no run loop)", deadline.duration_since(t0).as_secs());
        std::process::exit(1);
    }
    if frames == 0 {
        println!("capture started but no frames arrived in {} s", t0.elapsed().as_secs());
        std::process::exit(1);
    }
    let secs = t0.elapsed().as_secs_f32();
    println!(
        "{frames} frames {}x{}, {} unchanged skipped, {:.0} KB/frame avg, {:.1} fps over {secs:.1} s",
        dims.0,
        dims.1,
        unchanged,
        bytes as f32 / frames as f32 / 1024.0,
        frames as f32 / secs
    );
    std::process::exit(0)
}

#[cfg(target_os = "macos")]
fn pump_main_run_loop(for_: Duration) {
    use objc2_foundation::{NSDate, NSRunLoop};
    let until = NSDate::dateWithTimeIntervalSinceNow(for_.as_secs_f64());
    NSRunLoop::mainRunLoop().runUntilDate(&until);
}

#[cfg(not(target_os = "macos"))]
fn pump_main_run_loop(for_: Duration) {
    std::thread::sleep(for_);
}

/// The shared side. `screens`: this computer's displays in physical pixels; the primary one is streamed and
/// the viewer's positions land on it.
pub async fn serve(stream: Stream, engine: Arc<dyn SpatialPlatformEngine>, screens: Vec<Rect>) -> io::Result<()> {
    let (mut rd, mut wr) = tokio::io::split(stream);
    // the displays as the capture backend sees them (physical px); the app's monitor list is the fallback
    let mut displays = cap::displays();
    if displays.is_empty() {
        displays = screens.iter().map(|r| Display { rect: *r, primary: r.x == 0.0 && r.y == 0.0 }).collect();
    }
    if displays.is_empty() {
        return say(&mut wr, ERROR, b"no display to share").await;
    }
    let chosen = displays.iter().position(|d| d.primary).unwrap_or(0);
    let slot = Arc::new(Slot::default());
    let capture = match start_capture(slot.clone(), chosen) {
        Ok(c) => c,
        Err(e) => {
            journal!("screen share refused: {e}");
            return say(&mut wr, ERROR, e.as_bytes()).await;
        }
    };
    // the viewer may switch displays mid-stream: the capture and the rect its positions map onto are shared
    let capture = Arc::new(Mutex::new(Some(capture)));
    let display = Arc::new(Mutex::new(displays[chosen].rect));
    say(&mut wr, INFO, &info_body(&displays, chosen)).await?;

    // encoder thread → bounded queue → writer; a full queue drops the frame (the next one is newer anyway).
    // JPEG until the viewer asks for video (`want_video`); the H.264 encoder is made on that first frame.
    let (tx, mut rx) = mpsc::channel::<(u8, Vec<u8>)>(2);
    let (tx_info, tx_clip) = (tx.clone(), tx.clone());
    let encoding = Arc::new(AtomicBool::new(true));
    let want_video = Arc::new(AtomicBool::new(false));
    let (slot2, enc2, video2) = (slot.clone(), encoding.clone(), want_video.clone());
    std::thread::Builder::new()
        .name("tcuflow-encode".into())
        .spawn(move || {
            let mut last = 0u64;
            let mut h264: Option<H264> = None;
            while enc2.load(Ordering::Relaxed) {
                let Some(rgb) = slot2.take(Duration::from_millis(500)) else { continue };
                let fp = fingerprint(&rgb);
                if fp == last {
                    continue;
                }
                if video2.load(Ordering::Relaxed) {
                    if h264.as_ref().is_none_or(|h| (h.w, h.h) != (rgb.w, rgb.h)) {
                        match H264::new(rgb.w, rgb.h) {
                            Ok(h) => h264 = Some(h),
                            Err(e) => {
                                journal!("H.264 unavailable, staying with JPEG: {e}");
                                video2.store(false, Ordering::Relaxed);
                            }
                        }
                    }
                    if let Some(h) = h264.as_mut() {
                        match h.encode(&rgb) {
                            Ok(Some((_, body))) => {
                                last = fp;
                                let _ = tx.try_send((VIDEO, body));
                            }
                            Ok(None) => {}
                            Err(e) => journal!("screen encode (h264): {e}"),
                        }
                        continue;
                    }
                } else if h264.is_some() {
                    h264 = None; // the viewer went back to JPEG
                }
                match encode(&rgb) {
                    Ok(jpeg) => {
                        last = fp;
                        let _ = tx.try_send((FRAME, jpeg));
                    }
                    Err(e) => journal!("screen encode: {e}"),
                }
            }
        })
        .map_err(io::Error::other)?;
    let writer = async move {
        while let Some((tag, body)) = rx.recv().await {
            say(&mut wr, tag, &body).await?;
        }
        Ok::<(), io::Error>(())
    };
    // keys and buttons the viewer holds right now: released when it goes away, so nothing stays pressed
    let held: Arc<Mutex<(std::collections::HashSet<u16>, std::collections::HashSet<u8>)>> = Arc::default();
    let (held2, engine2) = (held.clone(), engine.clone());
    let (capture_r, display_r, slot_r) = (capture.clone(), display.clone(), slot.clone());
    // text copied here while viewed goes to the viewer; what it sends must not bounce straight back
    let last_clip: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(crate::platform::clipboard_text()));
    let clip_watch = {
        let (tx, last) = (tx_clip, last_clip.clone());
        async move {
            let mut tick = tokio::time::interval(Duration::from_millis(500));
            loop {
                tick.tick().await;
                if !crate::platform::clipboard_shared() {
                    continue;
                }
                let now = tokio::task::spawn_blocking(crate::platform::clipboard_text).await.ok().flatten();
                let fresh = {
                    let mut l = last.lock().unwrap();
                    (now.is_some() && now != *l).then(|| {
                        *l = now.clone();
                        now.unwrap()
                    })
                };
                if let Some(text) = fresh.filter(|t| t.len() <= MAX_CLIP) {
                    if tx.send((CLIP, text.into_bytes())).await.is_err() {
                        break;
                    }
                }
            }
            Ok::<(), io::Error>(())
        }
    };
    // the viewer's input, injected on this computer
    let reader = async move {
        let mut b = [0u8; 9];
        let mut shown = chosen;
        loop {
            rd.read_exact(&mut b).await?;
            match b[0] {
                2 if (1..=3).contains(&b[1]) => {
                    let mut h = held2.lock().unwrap();
                    if b[2] != 0 { h.1.insert(b[1]) } else { h.1.remove(&b[1]) };
                }
                4 => {
                    let mut h = held2.lock().unwrap();
                    let scan = u16::from_le_bytes([b[1], b[2]]);
                    if b[3] != 0 { h.0.insert(scan) } else { h.0.remove(&scan) };
                }
                _ => {}
            }
            let event = match b[0] {
                1 => {
                    let nx = f32::from_le_bytes(b[1..5].try_into().unwrap()).clamp(0.0, 1.0) as f64;
                    let ny = f32::from_le_bytes(b[5..9].try_into().unwrap()).clamp(0.0, 1.0) as f64;
                    let d = *display_r.lock().unwrap();
                    Injected::MoveTo { x: d.x + nx * d.w, y: d.y + ny * d.h }
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
                6 => {
                    want_video.store(b[1] == 1, Ordering::Relaxed);
                    continue;
                }
                8 => {
                    let len = u32::from_le_bytes(b[1..5].try_into().unwrap()) as usize;
                    if len > MAX_CLIP {
                        return Err(io::Error::new(io::ErrorKind::InvalidData, "clipboard too long"));
                    }
                    let mut text = vec![0u8; len];
                    rd.read_exact(&mut text).await?;
                    if crate::platform::clipboard_shared() {
                        let text = String::from_utf8_lossy(&text).into_owned();
                        *last_clip.lock().unwrap() = Some(text.clone());
                        tokio::task::spawn_blocking(move || crate::platform::set_clipboard_text(&text)).await.ok();
                    }
                    continue;
                }
                7 => {
                    let want = b[1] as usize;
                    if want < displays.len() && want != shown {
                        *capture_r.lock().unwrap() = None; // stops the current capture first
                        let sl = slot_r.clone();
                        match tokio::task::spawn_blocking(move || start_capture(sl, want)).await.map_err(io::Error::other)? {
                            Ok(c) => {
                                *capture_r.lock().unwrap() = Some(c);
                                *display_r.lock().unwrap() = displays[want].rect;
                                shown = want;
                                let _ = tx_info.send((INFO, info_body(&displays, want))).await;
                            }
                            Err(e) => journal!("switching display: {e}"),
                        }
                    }
                    continue;
                }
                _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "bad input frame")),
            };
            engine.inject(event);
        }
    };
    let stopped = END.notified();
    tokio::pin!(stopped);
    stopped.as_mut().enable();
    let r = tokio::select! {
        r = writer => r,
        r = reader => r,
        r = clip_watch => r,
        () = stopped => Ok(()),
    };
    encoding.store(false, Ordering::Relaxed);
    *capture.lock().unwrap() = None;
    let (keys, buttons) = std::mem::take(&mut *held.lock().unwrap());
    for scan in keys {
        engine2.inject(Injected::Key { scan, down: false });
    }
    for button in buttons {
        engine2.inject(Injected::Button { button, down: false });
    }
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

    /// Every display, in ScreenCaptureKit's order, with its bounds in physical pixels; empty without permission.
    pub fn displays() -> Vec<Display> {
        let Ok(content) = SCShareableContent::get() else { return Vec::new() };
        let main = crate::platform::macos::main_display_id();
        content
            .displays()
            .into_iter()
            .map(|d| {
                let id = d.display_id();
                Display { rect: crate::platform::macos::display_bounds_px(id), primary: id == main }
            })
            .collect()
    }

    /// Needs Screen Recording permission; macOS prompts on the first call and refuses until granted.
    pub fn run(slot: Arc<Slot>, stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>, index: usize) {
        let explain = |e: SCError| format!("this Mac hasn't allowed TCuFlow to record the screen: System Settings → Privacy & Security → Screen & System Audio Recording ({e})");
        let result = (|| {
            let content = SCShareableContent::get().map_err(explain)?;
            let display = content.displays().into_iter().nth(index).ok_or("no such display to share")?;
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

    /// Every monitor, in enumeration order, with its bounds in physical pixels.
    pub fn displays() -> Vec<Display> {
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO, MONITORINFOF_PRIMARY};
        let Ok(monitors) = Monitor::enumerate() else { return Vec::new() };
        monitors
            .iter()
            .filter_map(|m| {
                let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
                // SAFETY: a live monitor handle and a MONITORINFO with its size set, as the API requires
                if !unsafe { GetMonitorInfoW(HMONITOR(m.as_raw_hmonitor()), &mut mi) }.as_bool() {
                    return None;
                }
                let r = mi.rcMonitor;
                Some(Display {
                    rect: Rect { x: r.left as f64, y: r.top as f64, w: (r.right - r.left) as f64, h: (r.bottom - r.top) as f64 },
                    primary: mi.dwFlags & MONITORINFOF_PRIMARY != 0,
                })
            })
            .collect()
    }

    /// Windows Graphics Capture of monitor `index`; no permission prompt, but the secure desktop
    /// (UAC, lock screen) is never captured.
    pub fn run(slot: Arc<Slot>, stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>, index: usize) {
        let monitor = match Monitor::enumerate().map(|v| v.into_iter().nth(index)) {
            Ok(Some(m)) => m,
            Ok(None) => {
                let _ = started.send(Err("no such monitor to share".into()));
                return;
            }
            Err(e) => {
                let _ = started.send(Err(format!("no monitor: {e}")));
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
    pub fn displays() -> Vec<Display> {
        Vec::new()
    }
    pub fn run(_slot: Arc<Slot>, _stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>, _index: usize) {
        let _ = started.send(Err("screen sharing isn't available on this device".into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn h264_frames_start_with_a_key_frame_and_carry_their_size() {
        let (w, h) = (320u32, 200u32);
        let mut rgb = Rgb { w, h, data: vec![0; (w * h * 3) as usize] };
        let mut enc = H264::new(w, h).unwrap();
        let (key, body) = enc.encode(&rgb).unwrap().expect("first frame");
        assert!(key, "the first frame is an IDR");
        assert_eq!(&body[..5], &[1, 64, 1, 200, 0], "key flag, width 320, height 200");
        assert_eq!(&body[5..9], &[0, 0, 0, 1], "Annex B start code");
        assert!(body.len() > 9);
        // a change makes a (smaller) delta frame
        for px in rgb.data.chunks_mut(3).take(5000) {
            px[0] = 200;
        }
        let (key2, body2) = enc.encode(&rgb).unwrap().expect("second frame");
        assert!(!key2);
        assert!(body2.len() < body.len());
    }

    #[test]
    fn pack_converts_bgra_and_downscales_by_whole_pixels() {
        // 2x2 BGRA image, stride with padding
        let src = [10u8, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0, 10, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0];
        let rgb = pack(&src, 2, 2, 12, true);
        assert_eq!((rgb.w, rgb.h), (2, 2));
        assert_eq!(rgb.data, vec![30, 20, 10, 60, 50, 40, 30, 20, 10, 60, 50, 40]);
        // 4000 px wide → factor 3 → 1333 wide, rounded down to even for H.264, each output pixel the mean of a 3x3 block
        let w = 4000u32;
        let src = vec![100u8; (w * 3 * 4) as usize];
        let rgb = pack(&src, w, 3, (w * 4) as usize, false);
        assert_eq!((rgb.w, rgb.h), (1332, 0), "an odd height rounds to even too");
        let src = vec![100u8; (w * 6 * 4) as usize];
        let rgb = pack(&src, w, 6, (w * 4) as usize, false);
        assert_eq!((rgb.w, rgb.h), (1332, 2));
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

    // A real capture can't run under `cargo test` (ScreenCaptureKit answers on the app's main run loop):
    // `tcuflow --screen-probe` is that check, and `npm run sim` → View screen the end-to-end one.

    #[test]
    fn info_lists_every_display_and_which_is_shown() {
        let displays = vec![
            Display { rect: Rect { x: 0.0, y: 0.0, w: 2560.0, h: 1440.0 }, primary: true },
            Display { rect: Rect { x: 2560.0, y: 0.0, w: 1920.0, h: 1080.0 }, primary: false },
        ];
        let b = info_body(&displays, 1);
        assert_eq!(&b[..8], &[128, 7, 0, 0, 56, 4, 0, 0], "1920×1080 shown");
        assert_eq!(&b[8..10], &[1, 2], "shown index, count");
        assert_eq!(b.len(), 10 + 2 * 9);
        assert_eq!(b[18], 1, "the first display is the main one");
        assert_eq!(b[27], 0);
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
