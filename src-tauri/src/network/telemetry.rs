// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
//! 60 Hz spatial telemetry: fixed 12-byte little-endian UDP packets, built on the stack.
//!
//! On the wire each one is signed (TCuFlow): `"LS" | packet (12) | key id (8) | counter u32 LE | tag (32)`,
//! the tag being HMAC-SHA256 over the 26 bytes before it. The key is random per run of the
//! sender and handed to each paired device over the authenticated link (`kvm::Service::Glow`) before the
//! first packet; the key id is the first 8 characters of the sender's fingerprint. A receiver drops what it
//! can't verify and anything whose counter doesn't advance (replays), so nobody else on the Wi-Fi can light
//! an edge or fake a drop.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::{io, net::SocketAddr};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UdpSocket;

pub const PORT: u16 = 53419;
pub const MAGIC: [u8; 2] = *b"LK";
pub const PACKET_LEN: usize = 12;
const SIGNED_MAGIC: [u8; 2] = *b"LS";
pub const KEY_LEN: usize = 32;
const ID_LEN: usize = 8;
const TAG_LEN: usize = 32;
const SIGNED_LEN: usize = 2 + PACKET_LEN + ID_LEN + 4 + TAG_LEN;

pub type Key = [u8; KEY_LEN];
pub type KeyId = [u8; ID_LEN];
/// Senders this device accepts packets from: key and the last counter seen, by key id.
pub type Keys = Arc<Mutex<HashMap<KeyId, (Key, u32)>>>;

/// The first 8 characters of a fingerprint: enough to pick the key, the tag does the proving.
pub fn key_id(fingerprint: &str) -> KeyId {
    let mut id = [0u8; ID_LEN];
    let b = fingerprint.as_bytes();
    let n = b.len().min(ID_LEN);
    id[..n].copy_from_slice(&b[..n]);
    id
}

/// This run's sending key and a counter that never repeats within it.
pub struct Signer {
    pub key: Key,
    counter: AtomicU32,
}

impl Default for Signer {
    fn default() -> Self {
        Self::new()
    }
}

impl Signer {
    pub fn new() -> Self {
        use ring::rand::SecureRandom;
        let mut key = [0u8; KEY_LEN];
        ring::rand::SystemRandom::new().fill(&mut key).expect("system random");
        Self { key, counter: AtomicU32::new(1) }
    }

    pub fn sign(&self, p: &SpatialPacket, id: &KeyId) -> [u8; SIGNED_LEN] {
        let mut b = [0u8; SIGNED_LEN];
        b[0..2].copy_from_slice(&SIGNED_MAGIC);
        b[2..2 + PACKET_LEN].copy_from_slice(&p.encode());
        b[14..14 + ID_LEN].copy_from_slice(id);
        b[22..26].copy_from_slice(&self.counter.fetch_add(1, Ordering::Relaxed).to_le_bytes());
        let tag = ring::hmac::sign(&ring::hmac::Key::new(ring::hmac::HMAC_SHA256, &self.key), &b[..26]);
        b[26..].copy_from_slice(tag.as_ref());
        b
    }
}

/// A signed datagram from a sender in `keys`, or `None` (unknown sender, bad tag, replay, malformed).
pub fn verify(b: &[u8], keys: &Keys) -> Option<SpatialPacket> {
    if b.len() != SIGNED_LEN || b[0..2] != SIGNED_MAGIC {
        return None;
    }
    let id: KeyId = b[14..22].try_into().ok()?;
    let counter = u32::from_le_bytes(b[22..26].try_into().ok()?);
    let mut keys = keys.lock().unwrap();
    let (key, last) = keys.get_mut(&id)?;
    ring::hmac::verify(&ring::hmac::Key::new(ring::hmac::HMAC_SHA256, key), &b[..26], &b[26..]).ok()?;
    if counter <= *last {
        return None;
    }
    *last = counter;
    SpatialPacket::decode(&b[2..2 + PACKET_LEN])
}

/// Service `Glow`: the other side hands over the key its packets will carry (32 bytes, then it closes).
pub async fn receive_key(mut stream: impl AsyncReadExt + Unpin, keys: &Keys, fingerprint: &str) -> io::Result<()> {
    let mut key = [0u8; KEY_LEN];
    stream.read_exact(&mut key).await?;
    keys.lock().unwrap().insert(key_id(fingerprint), (key, 0));
    Ok(())
}

/// The client side of `Glow`.
pub async fn send_key(mut stream: impl AsyncWriteExt + Unpin, signer: &Signer) -> io::Result<()> {
    stream.write_all(&signer.key).await?;
    stream.shutdown().await
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum PacketType {
    Proximity = 1,
    Drop = 2,
    Leave = 3,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum PayloadKind {
    None = 0,
    File = 1,
    Text = 2,
    Url = 3,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpatialPacket {
    pub kind: PacketType,
    pub normalized_y: f32,
    pub proximity: f32,
    pub payload: PayloadKind,
}

impl SpatialPacket {
    pub fn encode(&self) -> [u8; PACKET_LEN] {
        let mut b = [0u8; PACKET_LEN];
        b[0..2].copy_from_slice(&MAGIC);
        b[2] = self.kind as u8;
        b[3..7].copy_from_slice(&self.normalized_y.to_le_bytes());
        b[7..11].copy_from_slice(&self.proximity.to_le_bytes());
        b[11] = self.payload as u8;
        b
    }

    pub fn decode(b: &[u8]) -> Option<Self> {
        if b.len() != PACKET_LEN || b[0..2] != MAGIC {
            return None;
        }
        let kind = match b[2] {
            1 => PacketType::Proximity,
            2 => PacketType::Drop,
            3 => PacketType::Leave,
            _ => return None,
        };
        let payload = match b[11] {
            0 => PayloadKind::None,
            1 => PayloadKind::File,
            2 => PayloadKind::Text,
            3 => PayloadKind::Url,
            _ => return None,
        };
        let f = |r: std::ops::Range<usize>| f32::from_le_bytes(b[r].try_into().unwrap());
        let (normalized_y, proximity) = (f(3..7), f(7..11));
        // clamp at the trust boundary; NaN fails the range check
        if !(0.0..=1.0).contains(&normalized_y) || !(0.0..=1.0).contains(&proximity) {
            return None;
        }
        Some(Self { kind, normalized_y, proximity, payload })
    }
}

pub async fn sender() -> io::Result<UdpSocket> {
    UdpSocket::bind(("0.0.0.0", 0)).await
}

pub async fn send(sock: &UdpSocket, to: SocketAddr, p: &SpatialPacket, signer: &Signer, id: &KeyId) {
    let _ = sock.send_to(&signer.sign(p, id), to).await; // unreliable by design; next tick supersedes
}

/// Receive packets forever from the senders in `keys`; everything else is dropped silently.
pub async fn listen(port: u16, keys: Keys, mut on_packet: impl FnMut(SpatialPacket) + Send) -> io::Result<()> {
    let sock = UdpSocket::bind(("0.0.0.0", port)).await?;
    let mut buf = [0u8; 64];
    loop {
        let (n, _) = sock.recv_from(&mut buf).await?;
        if let Some(p) = verify(&buf[..n], &keys) {
            on_packet(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_layout() {
        let p = SpatialPacket { kind: PacketType::Drop, normalized_y: 0.25, proximity: 1.0, payload: PayloadKind::Url };
        let b = p.encode();
        assert_eq!(&b[..3], b"LK\x02");
        assert_eq!(b[11], 3);
        assert_eq!(SpatialPacket::decode(&b), Some(p));
    }

    #[test]
    fn rejects_garbage() {
        let mut b = SpatialPacket { kind: PacketType::Leave, normalized_y: 0.0, proximity: 0.0, payload: PayloadKind::None }.encode();
        assert!(SpatialPacket::decode(&b[..11]).is_none());
        b[3..7].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(SpatialPacket::decode(&b).is_none());
        b[0] = b'X';
        assert!(SpatialPacket::decode(&b).is_none());
    }

    #[test]
    fn only_a_known_key_passes_and_never_twice() {
        let p = SpatialPacket { kind: PacketType::Proximity, normalized_y: 0.5, proximity: 0.7, payload: PayloadKind::None };
        let (me, stranger) = (Signer::new(), Signer::new());
        let id = key_id("abcdef0123456789");
        let keys: Keys = Default::default();
        keys.lock().unwrap().insert(id, (me.key, 0));
        let signed = me.sign(&p, &id);
        assert_eq!(verify(&signed, &keys), Some(p));
        assert_eq!(verify(&signed, &keys), None, "a replay");
        assert_eq!(verify(&me.sign(&p, &id), &keys), Some(p), "the next counter");
        assert_eq!(verify(&stranger.sign(&p, &id), &keys), None, "someone else's key under our id");
        assert_eq!(verify(&me.sign(&p, &key_id("unknown")), &keys), None);
        let mut bent = me.sign(&p, &id);
        bent[5] ^= 1;
        assert_eq!(verify(&bent, &keys), None, "a changed payload fails the tag");
        assert_eq!(verify(&p.encode(), &keys), None, "an unsigned packet");
    }

    #[tokio::test]
    async fn key_handover_over_a_stream() {
        let signer = Signer::new();
        let (a, b) = tokio::io::duplex(64);
        let keys: Keys = Default::default();
        let (sent, got) = tokio::join!(send_key(a, &signer), receive_key(b, &keys, "0123456789abcdef"));
        sent.unwrap();
        got.unwrap();
        assert_eq!(keys.lock().unwrap().get(&key_id("0123456789abcdef")).map(|k| k.0), Some(signer.key));
    }
}
