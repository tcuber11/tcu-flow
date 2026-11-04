//! Remote screen: a paired device's primary display streamed over the pinned link, with the viewer's mouse
//! and keyboard sent back and injected there. Opt-in on the shared side ("Share my screen"), refused
//! otherwise like every service. Frames are downscaled to at most 1600 px wide and sent at up to 20 fps:
//! as H.264 (~3 Mbit/s; the Mac's media engine through VideoToolbox, OpenH264 on the CPU elsewhere) once
//! the viewer says it can decode video (its webview's WebCodecs), as JPEG until then and for a viewer that
//! can't. Encoded video is never dropped (every frame builds on the one before); while the link is busy
//! the capture slot drops raw frames instead.
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
//!   copied on the viewer, for the shared computer's clipboard. Both directions obey "Its clipboard" there;
//!   9 key frame, no payload: the viewer's decoder lost its place (it fell behind, or failed) and starts over.
//! Any malformed client frame ends the session, and so does the viewer going away: the capture stops with it.

use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

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

/// The H.264 encoder for one stream, remade when the frame size changes: VideoToolbox on a Mac (its media
/// engine, next to no CPU), OpenH264 on the CPU elsewhere and when VideoToolbox won't open a session. Both
/// give baseline-profile Annex B without B-frames, so the viewer can't tell which one made a frame.
struct H264 {
    w: u32,
    h: u32,
    backend: Backend,
}

enum Backend {
    #[cfg(target_os = "macos")]
    VideoToolbox(vt::Session),
    OpenH264 {
        enc: openh264::encoder::Encoder,
        yuv: openh264::formats::YUVBuffer,
        started: std::time::Instant,
    },
}

impl H264 {
    fn new(w: u32, h: u32) -> io::Result<Self> {
        #[cfg(target_os = "macos")]
        match vt::Session::new(w, h) {
            Ok(s) => return Ok(Self { w, h, backend: Backend::VideoToolbox(s) }),
            Err(e) => journal!("VideoToolbox unavailable, encoding on the CPU: {e}"),
        }
        Self::software(w, h)
    }

    fn software(w: u32, h: u32) -> io::Result<Self> {
        use openh264::encoder::{BitRate, EncoderConfig, FrameRate, RateControlMode, UsageType};
        let config = EncoderConfig::new()
            .usage_type(UsageType::ScreenContentRealTime)
            .rate_control_mode(RateControlMode::Bitrate)
            .bitrate(BitRate::from_bps(BITRATE))
            .max_frame_rate(FrameRate::from_hz(1000.0 / MIN_INTERVAL.as_millis() as f32))
            .skip_frames(false);
        let enc = openh264::encoder::Encoder::with_api_config(openh264::OpenH264API::from_source(), config).map_err(io::Error::other)?;
        let yuv = openh264::formats::YUVBuffer::new(w as usize, h as usize);
        Ok(Self { w, h, backend: Backend::OpenH264 { enc, yuv, started: std::time::Instant::now() } })
    }

    /// The next frame comes out as a key frame: the viewer lost its place and asked for one.
    fn force_key(&mut self) {
        match &mut self.backend {
            #[cfg(target_os = "macos")]
            Backend::VideoToolbox(s) => s.force_key(),
            Backend::OpenH264 { enc, .. } => enc.force_intra_frame(),
        }
    }

    /// `(key frame?, tag-4 body)`, or `None` when the encoder dropped the frame (before encoding it, so
    /// nothing later refers to it).
    fn encode(&mut self, rgb: &Rgb) -> io::Result<Option<(bool, Vec<u8>)>> {
        let mut body = vec![0u8];
        body.extend_from_slice(&(rgb.w as u16).to_le_bytes());
        body.extend_from_slice(&(rgb.h as u16).to_le_bytes());
        let key = match &mut self.backend {
            #[cfg(target_os = "macos")]
            Backend::VideoToolbox(s) => match s.encode(rgb, &mut body)? {
                Some(key) => key,
                None => return Ok(None),
            },
            Backend::OpenH264 { enc, yuv, started } => {
                use openh264::encoder::FrameType;
                yuv.read_rgb8(openh264::formats::RgbSliceU8::new(&rgb.data, (rgb.w as usize, rgb.h as usize)));
                let at = openh264::Timestamp::from_millis(started.elapsed().as_millis() as u64);
                let out = enc.encode_at(&*yuv, at).map_err(io::Error::other)?;
                let key = match out.frame_type() {
                    FrameType::Skip | FrameType::Invalid => return Ok(None),
                    FrameType::IDR | FrameType::I => true,
                    _ => false,
                };
                out.write_vec(&mut body);
                key
            }
        };
        body[0] = key as u8;
        Ok(Some((key, body)))
    }
}

/// VideoToolbox's H.264 encoder, called synchronously: one frame in, `CompleteFrames`, its access unit out.
#[cfg(target_os = "macos")]
mod vt {
    use super::Rgb;
    use std::ffi::c_void;
    use std::io;
    use std::ptr::{null, null_mut};
    use std::sync::Mutex;

    type Ref = *const c_void;
    type OutputCallback = unsafe extern "C" fn(refcon: *mut c_void, frame: *mut c_void, status: i32, flags: u32, sample: Ref);

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CMTime {
        value: i64,
        timescale: i32,
        flags: u32,
        epoch: i64,
    }

    /// kCMTimeInvalid: no duration, and "complete every pending frame"
    const NO_TIME: CMTime = CMTime { value: 0, timescale: 0, flags: 0, epoch: 0 };
    const TIME_VALID: u32 = 1;
    const CODEC_H264: u32 = u32::from_be_bytes(*b"avc1");
    const PIXEL_BGRA: u32 = u32::from_be_bytes(*b"BGRA");
    const NUMBER_SINT32: isize = 3;
    /// Annex B start code, in front of every NAL unit
    const START: [u8; 4] = [0, 0, 0, 1];

    #[link(name = "VideoToolbox", kind = "framework")]
    extern "C" {
        static kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: Ref;
        static kVTCompressionPropertyKey_RealTime: Ref;
        static kVTCompressionPropertyKey_AllowFrameReordering: Ref;
        static kVTCompressionPropertyKey_ProfileLevel: Ref;
        static kVTProfileLevel_H264_Baseline_AutoLevel: Ref;
        static kVTCompressionPropertyKey_AverageBitRate: Ref;
        static kVTCompressionPropertyKey_ExpectedFrameRate: Ref;
        static kVTCompressionPropertyKey_MaxKeyFrameInterval: Ref;
        static kVTEncodeFrameOptionKey_ForceKeyFrame: Ref;
        fn VTCompressionSessionCreate(
            allocator: Ref,
            width: i32,
            height: i32,
            codec: u32,
            encoder_specification: Ref,
            source_attributes: Ref,
            data_allocator: Ref,
            callback: Option<OutputCallback>,
            refcon: *mut c_void,
            session_out: *mut Ref,
        ) -> i32;
        fn VTSessionSetProperty(session: Ref, key: Ref, value: Ref) -> i32;
        fn VTCompressionSessionPrepareToEncodeFrames(session: Ref) -> i32;
        fn VTCompressionSessionEncodeFrame(session: Ref, image: Ref, pts: CMTime, duration: CMTime, properties: Ref, frame_refcon: *mut c_void, info_out: *mut u32) -> i32;
        fn VTCompressionSessionCompleteFrames(session: Ref, until: CMTime) -> i32;
        fn VTCompressionSessionInvalidate(session: Ref);
    }

    #[link(name = "CoreMedia", kind = "framework")]
    extern "C" {
        static kCMSampleAttachmentKey_NotSync: Ref;
        fn CMSampleBufferGetSampleAttachmentsArray(sample: Ref, create: u8) -> Ref;
        fn CMSampleBufferGetFormatDescription(sample: Ref) -> Ref;
        fn CMSampleBufferGetDataBuffer(sample: Ref) -> Ref;
        fn CMBlockBufferGetDataLength(block: Ref) -> usize;
        fn CMBlockBufferCopyDataBytes(block: Ref, offset: usize, len: usize, destination: *mut c_void) -> i32;
        fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
            description: Ref,
            index: usize,
            set_out: *mut *const u8,
            size_out: *mut usize,
            count_out: *mut usize,
            nal_header_length_out: *mut i32,
        ) -> i32;
    }

    #[link(name = "CoreVideo", kind = "framework")]
    extern "C" {
        fn CVPixelBufferCreate(allocator: Ref, width: usize, height: usize, format: u32, attributes: Ref, buffer_out: *mut Ref) -> i32;
        fn CVPixelBufferLockBaseAddress(buffer: Ref, flags: u64) -> i32;
        fn CVPixelBufferUnlockBaseAddress(buffer: Ref, flags: u64) -> i32;
        fn CVPixelBufferGetBaseAddress(buffer: Ref) -> *mut u8;
        fn CVPixelBufferGetBytesPerRow(buffer: Ref) -> usize;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFBooleanTrue: Ref;
        static kCFBooleanFalse: Ref;
        // declared as in platform::macos, which uses them too
        static kCFTypeDictionaryKeyCallBacks: c_void;
        static kCFTypeDictionaryValueCallBacks: c_void;
        fn CFDictionaryCreate(allocator: *const c_void, keys: *const *const c_void, values: *const *const c_void, count: isize, key_callbacks: *const c_void, value_callbacks: *const c_void) -> *mut c_void;
        fn CFDictionaryGetValue(dictionary: Ref, key: Ref) -> Ref;
        fn CFArrayGetCount(array: Ref) -> isize;
        fn CFArrayGetValueAtIndex(array: Ref, index: isize) -> Ref;
        fn CFNumberCreate(allocator: Ref, kind: isize, value: *const c_void) -> Ref;
        fn CFRelease(object: Ref);
    }

    /// Where the output callback leaves the frame it was handed: `(key frame?, Annex B)`.
    type Out = Mutex<Option<(bool, Vec<u8>)>>;

    pub struct Session {
        session: Ref,
        /// frame options asking for a key frame, made once
        key_frame: Ref,
        force_key: bool,
        out: Box<Out>,
        started: std::time::Instant,
        last_pts: i64,
        w: usize,
        h: usize,
    }

    // SAFETY: a session is made, used and dropped by the one encoder thread that owns it
    unsafe impl Send for Session {}

    impl Session {
        pub fn new(w: u32, h: u32) -> io::Result<Self> {
            let out: Box<Out> = Box::default();
            // SAFETY: every CF object made here is released here or by Drop; the callback's refcon is `out`'s
            // heap address, which outlives the session (Drop invalidates the session before `out` goes)
            unsafe {
                let spec = dictionary(&[kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder], &[kCFBooleanTrue]);
                let mut session: Ref = null();
                let status = VTCompressionSessionCreate(null(), w as i32, h as i32, CODEC_H264, spec, null(), null(), Some(on_output), &*out as *const Out as *mut c_void, &mut session);
                CFRelease(spec);
                if status != 0 || session.is_null() {
                    return Err(io::Error::other(format!("VTCompressionSessionCreate: OSStatus {status}")));
                }
                let key_frame = dictionary(&[kVTEncodeFrameOptionKey_ForceKeyFrame], &[kCFBooleanTrue]);
                let me = Self { session, key_frame, force_key: false, out, started: std::time::Instant::now(), last_pts: -1, w: w as usize, h: h as usize };
                // without reordering every frame comes out as it goes in: one access unit per CompleteFrames
                let status = VTSessionSetProperty(session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
                if status != 0 {
                    return Err(io::Error::other(format!("no frame reordering control: OSStatus {status}")));
                }
                let (rate, fps, gop) = (number(super::BITRATE as i32), number((1000 / super::MIN_INTERVAL.as_millis()) as i32), number(1200));
                for (key, value) in [
                    (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
                    (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Baseline_AutoLevel),
                    (kVTCompressionPropertyKey_AverageBitRate, rate),
                    (kVTCompressionPropertyKey_ExpectedFrameRate, fps),
                    // key frames come when the viewer asks; one a minute regardless
                    (kVTCompressionPropertyKey_MaxKeyFrameInterval, gop),
                ] {
                    let status = VTSessionSetProperty(session, key, value);
                    if status != 0 {
                        journal!("VideoToolbox kept a default (OSStatus {status})");
                    }
                }
                for n in [rate, fps, gop] {
                    CFRelease(n);
                }
                let status = VTCompressionSessionPrepareToEncodeFrames(session);
                if status != 0 {
                    return Err(io::Error::other(format!("VTCompressionSessionPrepareToEncodeFrames: OSStatus {status}")));
                }
                Ok(me)
            }
        }

        pub fn force_key(&mut self) {
            self.force_key = true;
        }

        /// Encodes `rgb` and appends its Annex B bytes to `out`: `Some(key frame?)`, or `None` when the
        /// encoder dropped the frame (real-time mode may, under load, before anything refers to it).
        pub fn encode(&mut self, rgb: &Rgb, out: &mut Vec<u8>) -> io::Result<Option<bool>> {
            let (w, h) = (self.w, self.h);
            if (rgb.w as usize, rgb.h as usize) != (w, h) || rgb.data.len() < w * h * 3 {
                return Err(io::Error::other("frame size differs from the session's"));
            }
            // SAFETY: the pixel buffer is locked while written, rows stay within its bytes-per-row, and it
            // is released after the encoder took its own reference
            unsafe {
                let mut pixels: Ref = null();
                let status = CVPixelBufferCreate(null(), w, h, PIXEL_BGRA, null(), &mut pixels);
                if status != 0 || pixels.is_null() {
                    return Err(io::Error::other(format!("CVPixelBufferCreate: {status}")));
                }
                if CVPixelBufferLockBaseAddress(pixels, 0) != 0 {
                    CFRelease(pixels);
                    return Err(io::Error::other("can't write the pixel buffer"));
                }
                let (base, stride) = (CVPixelBufferGetBaseAddress(pixels), CVPixelBufferGetBytesPerRow(pixels));
                for y in 0..h {
                    let row = std::slice::from_raw_parts_mut(base.add(y * stride), w * 4);
                    for (px, src) in row.chunks_exact_mut(4).zip(rgb.data[y * w * 3..(y + 1) * w * 3].chunks_exact(3)) {
                        px.copy_from_slice(&[src[2], src[1], src[0], 255]);
                    }
                }
                CVPixelBufferUnlockBaseAddress(pixels, 0);
                // presentation times only have to increase: milliseconds since the session began
                let pts = (self.started.elapsed().as_millis() as i64).max(self.last_pts + 1);
                self.last_pts = pts;
                let options = if std::mem::take(&mut self.force_key) { self.key_frame } else { null() };
                let time = CMTime { value: pts, timescale: 1000, flags: TIME_VALID, epoch: 0 };
                let status = VTCompressionSessionEncodeFrame(self.session, pixels, time, NO_TIME, options, null_mut(), null_mut());
                CFRelease(pixels);
                if status != 0 {
                    return Err(io::Error::other(format!("VTCompressionSessionEncodeFrame: OSStatus {status}")));
                }
                VTCompressionSessionCompleteFrames(self.session, NO_TIME);
            }
            let Some((key, bytes)) = self.out.lock().unwrap_or_else(|p| p.into_inner()).take() else { return Ok(None) };
            out.extend_from_slice(&bytes);
            Ok(Some(key))
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            // SAFETY: invalidating waits out the callback, so `out` is no longer referenced afterwards
            unsafe {
                VTCompressionSessionInvalidate(self.session);
                CFRelease(self.session);
                CFRelease(self.key_frame);
            }
        }
    }

    /// Called by VideoToolbox (during CompleteFrames) with the encoded frame, or a null one when it dropped it.
    unsafe extern "C" fn on_output(refcon: *mut c_void, _frame: *mut c_void, status: i32, _flags: u32, sample: Ref) {
        let out = &*(refcon as *const Out);
        let frame = if status == 0 && !sample.is_null() { annex_b(sample) } else { None };
        *out.lock().unwrap_or_else(|p| p.into_inner()) = frame;
    }

    /// The sample's access unit in Annex B: SPS and PPS first on a key frame, then each NAL unit behind a
    /// start code instead of its big-endian length.
    unsafe fn annex_b(sample: Ref) -> Option<(bool, Vec<u8>)> {
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, 0);
        let not_sync = if !attachments.is_null() && CFArrayGetCount(attachments) > 0 {
            CFDictionaryGetValue(CFArrayGetValueAtIndex(attachments, 0), kCMSampleAttachmentKey_NotSync)
        } else {
            null()
        };
        let key = not_sync != kCFBooleanTrue;
        let format = CMSampleBufferGetFormatDescription(sample);
        if format.is_null() {
            return None;
        }
        let (mut sets, mut length_size) = (0usize, 4i32);
        if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, 0, null_mut(), null_mut(), &mut sets, &mut length_size) != 0 {
            return None;
        }
        let mut out = Vec::new();
        if key {
            for i in 0..sets {
                let (mut set, mut size) = (null(), 0usize);
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(format, i, &mut set, &mut size, null_mut(), null_mut()) == 0 && !set.is_null() {
                    out.extend_from_slice(&START);
                    out.extend_from_slice(std::slice::from_raw_parts(set, size));
                }
            }
        }
        let block = CMSampleBufferGetDataBuffer(sample);
        if block.is_null() {
            return None;
        }
        let len = CMBlockBufferGetDataLength(block);
        let mut avcc = vec![0u8; len];
        if CMBlockBufferCopyDataBytes(block, 0, len, avcc.as_mut_ptr().cast()) != 0 {
            return None;
        }
        let n = length_size.clamp(1, 4) as usize;
        let mut at = 0;
        while at + n <= avcc.len() {
            let unit = avcc[at..at + n].iter().fold(0usize, |l, &b| l << 8 | b as usize);
            at += n;
            if unit > avcc.len() - at {
                return None;
            }
            out.extend_from_slice(&START);
            out.extend_from_slice(&avcc[at..at + unit]);
            at += unit;
        }
        Some((key, out))
    }

    unsafe fn dictionary(keys: &[Ref], values: &[Ref]) -> Ref {
        CFDictionaryCreate(null(), keys.as_ptr(), values.as_ptr(), keys.len() as isize, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks)
    }

    unsafe fn number(n: i32) -> Ref {
        CFNumberCreate(null(), NUMBER_SINT32, (&n as *const i32).cast())
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
    /// macOS: its CGDirectDisplayID, which the viewer's positions are aimed at; 0 elsewhere
    pub id: u32,
}

/// The viewer's positions land on `d`. macOS: displays of different scales overlap in the pixel space positions
/// are given in (a 2× main display covers part of a 1× one beside it), so the shown one is named outright.
fn aim(d: &Display) {
    #[cfg(target_os = "macos")]
    crate::platform::macos::prefer_display(Some(d.id).filter(|&id| id != 0));
    #[cfg(not(target_os = "macos"))]
    let _ = d;
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
        displays = screens.iter().map(|r| Display { rect: *r, primary: r.x == 0.0 && r.y == 0.0, id: 0 }).collect();
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
    aim(&displays[chosen]);
    say(&mut wr, INFO, &info_body(&displays, chosen)).await?;

    // encoder thread → bounded queue → writer; a full queue drops the frame (the next one is newer anyway).
    // JPEG until the viewer asks for video (`want_video`); the H.264 encoder is made on that first frame.
    let (tx, mut rx) = mpsc::channel::<(u8, Vec<u8>)>(2);
    let (tx_info, tx_clip) = (tx.clone(), tx.clone());
    let encoding = Arc::new(AtomicBool::new(true));
    let want_video = Arc::new(AtomicBool::new(false));
    let want_key = Arc::new(AtomicBool::new(false));
    let (slot2, enc2, video2, key2) = (slot.clone(), encoding.clone(), want_video.clone(), want_key.clone());
    std::thread::Builder::new()
        .name("tcuflow-encode".into())
        .spawn(move || {
            let mut last = 0u64;
            let mut h264: Option<H264> = None;
            // the last frame sent as video: a viewer that lost its place gets it again as a key frame even
            // while the screen holds still and nothing new arrives
            let mut still: Option<Rgb> = None;
            while enc2.load(Ordering::Relaxed) {
                let rgb = match slot2.take(Duration::from_millis(500)) {
                    Some(rgb) => {
                        let fp = fingerprint(&rgb);
                        if fp == last && !key2.load(Ordering::Relaxed) {
                            continue;
                        }
                        last = fp;
                        rgb
                    }
                    None => match still.take() {
                        Some(rgb) if key2.load(Ordering::Relaxed) && video2.load(Ordering::Relaxed) => rgb,
                        other => {
                            still = other;
                            continue;
                        }
                    },
                };
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
                        let forced = key2.swap(false, Ordering::Relaxed);
                        if forced {
                            h.force_key();
                        }
                        let sent = match h.encode(&rgb) {
                            Ok(Some((_, body))) => {
                                // waits while the link is busy rather than dropping: every later frame
                                // builds on this one (the slot drops raw frames meanwhile)
                                if tx.blocking_send((VIDEO, body)).is_err() {
                                    break;
                                }
                                true
                            }
                            Ok(None) => false,
                            Err(e) => {
                                journal!("screen encode (h264): {e}");
                                false
                            }
                        };
                        if sent {
                            still = Some(rgb);
                        } else if forced {
                            // the key frame the viewer waits for was dropped: ask again, with this frame
                            // (the newest) kept for a screen that holds still
                            key2.store(true, Ordering::Relaxed);
                            still = Some(rgb);
                        }
                        continue;
                    }
                } else if h264.is_some() {
                    // the viewer went back to JPEG
                    h264 = None;
                    still = None;
                }
                match encode(&rgb) {
                    // a JPEG stands alone: when the link is busy it is dropped, the next one is newer anyway
                    Ok(jpeg) => {
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
                9 => {
                    want_key.store(true, Ordering::Relaxed);
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
                    if want != shown {
                        // displays come and go during a session: the list the viewer picked from may be stale
                        let now = tokio::task::spawn_blocking(cap::displays).await.unwrap_or_default();
                        if !now.is_empty() {
                            displays = now;
                        }
                        // the one on screen went away: whatever is picked, the capture has to start over
                        let lost = shown >= displays.len();
                        shown = shown.min(displays.len() - 1);
                        if want < displays.len() && (want != shown || lost) {
                            *capture_r.lock().unwrap() = None; // stops the current capture first
                            let sl = slot_r.clone();
                            let started = match tokio::task::spawn_blocking(move || start_capture(sl, want)).await.map_err(io::Error::other)? {
                                Ok(c) => Some((c, want)),
                                Err(e) => {
                                    journal!("switching display: {e}");
                                    // back to the one it was on, so the picture doesn't just stop
                                    let (sl, back) = (slot_r.clone(), shown);
                                    tokio::task::spawn_blocking(move || start_capture(sl, back)).await.map_err(io::Error::other)?.ok().map(|c| (c, back))
                                }
                            };
                            let Some((c, at)) = started else {
                                return Err(io::Error::other("no display can be captured any more"));
                            };
                            *capture_r.lock().unwrap() = Some(c);
                            *display_r.lock().unwrap() = displays[at].rect;
                            aim(&displays[at]);
                            shown = at;
                        }
                        // the viewer's picker shows what is really on screen, whichever way it went
                        let _ = tx_info.send((INFO, info_body(&displays, shown))).await;
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
    #[cfg(target_os = "macos")]
    crate::platform::macos::prefer_display(None);
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

// ---- the viewer window (desktop; the viewer's stream itself is `crate::viewer`) ------------------------

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
                Display { rect: crate::platform::macos::display_bounds_px(id), primary: id == main, id }
            })
            .collect()
    }

    /// Needs Screen Recording permission; macOS prompts on the first call and refuses until granted.
    pub fn run(slot: Arc<Slot>, stop: Arc<AtomicBool>, started: std::sync::mpsc::Sender<Result<(), String>>, index: usize) {
        // the viewer reads this; TCuFlow on the Mac itself shows what to switch on (This computer shares → Its screen)
        let explain = |e: SCError| format!("that Mac hasn't allowed TCuFlow to record its screen yet: open TCuFlow on it, Its screen under This computer shares says what to switch on ({e})");
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
        use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO};
        use windows_sys::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;
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
                    id: 0,
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

    /// What the viewer relies on from either backend: a key frame first, carrying its size and leading with
    /// its SPS; smaller deltas after; a key frame again when one is asked for.
    fn check_h264(mut enc: H264) {
        let (w, h) = (enc.w, enc.h);
        let mut rgb = Rgb { w, h, data: vec![0; (w * h * 3) as usize] };
        let (key, body) = enc.encode(&rgb).unwrap().expect("first frame");
        assert!(key, "the first frame is a key frame");
        assert_eq!(&body[..5], &[1, 64, 1, 200, 0], "key flag, width 320, height 200");
        assert_eq!(&body[5..9], &[0, 0, 0, 1], "Annex B start code");
        assert_eq!(body[9] & 0x1f, 7, "a key frame leads with its SPS");
        for px in rgb.data.chunks_mut(3).take(5000) {
            px[0] = 200;
        }
        let (key2, body2) = enc.encode(&rgb).unwrap().expect("second frame");
        assert!(!key2);
        assert_eq!(body2[0], 0);
        assert!(body2.len() < body.len());
        enc.force_key();
        rgb.data[0] = 1;
        let (key3, body3) = enc.encode(&rgb).unwrap().expect("third frame");
        assert!(key3, "a key frame when asked for");
        assert_eq!(body3[9] & 0x1f, 7);
    }

    #[test]
    fn openh264_frames() {
        check_h264(H264::software(320, 200).unwrap());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn videotoolbox_frames() {
        let enc = H264::new(320, 200).unwrap();
        assert!(matches!(enc.backend, Backend::VideoToolbox(_)), "VideoToolbox opened a session");
        check_h264(enc);
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
            Display { rect: Rect { x: 0.0, y: 0.0, w: 2560.0, h: 1440.0 }, primary: true, id: 0 },
            Display { rect: Rect { x: 2560.0, y: 0.0, w: 1920.0, h: 1080.0 }, primary: false, id: 0 },
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
