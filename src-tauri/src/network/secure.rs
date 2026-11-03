// Modified for TCuFlow (2026) from LOKA by Aufa Nirsad; see NOTICE.
//! Every link (input sessions, pairing, files, services) is a stream of a QUIC connection (TLS 1.3, ALPN
//! `tcuflow/1`) with a self-signed certificate per device. A device *is* its certificate: the fingerprint
//! (SHA-256 of the certificate) is what discovery announces, what pairing stores, and what each side
//! checks on every connection. Pairing shows a 6-digit code from both fingerprints and a nonce from each
//! side (the requester's committed before it sees the other's), so a device in the middle can't grind
//! certificates until both screens match; after pairing an impostor can't connect at all (it doesn't
//! have the private key). Keep-alives make a silently dead peer (Wi-Fi drop, sleep, crash) fail every
//! stream within `IDLE`, as `io::ErrorKind::TimedOut`.

use quinn::{
    crypto::rustls::{QuicClientConfig, QuicServerConfig},
    ClientConfig, Connection, Endpoint, ReadError, RecvStream, SendStream, ServerConfig, StoppedError, TransportConfig, VarInt, WriteError,
};
use ring::rand::SecureRandom;
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider},
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
    server::danger::{ClientCertVerified, ClientCertVerifier},
    DigitallySignedStruct, DistinguishedName, SignatureScheme,
};
use std::{
    collections::HashMap,
    future::Future,
    io,
    net::SocketAddr,
    path::Path,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{ready, Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::mpsc,
};

const ALPN: &[u8] = b"tcuflow/1";
/// A peer that sent nothing (not even a keep-alive) for this long is gone.
const IDLE: Duration = Duration::from_secs(3);
const KEEP_ALIVE: Duration = Duration::from_secs(1);
/// Another certificate answered where a paired device was expected (reinstalled, or the address moved on).
pub const WRONG_DEVICE: &str = "another device answered at that address";

type Acked = Pin<Box<dyn Future<Output = Result<Option<VarInt>, StoppedError>> + Send + Sync>>;

/// One bidirectional QUIC stream. `shutdown` finishes it and waits until the peer has every byte, so
/// nothing is lost when the caller then drops the stream (and with it maybe the last connection handle).
pub struct Stream {
    send: SendStream,
    recv: RecvStream,
    acked: Option<Acked>,
}

impl Stream {
    fn new((send, recv): (SendStream, RecvStream)) -> Self {
        Self { send, recv, acked: None }
    }
}

impl AsyncRead for Stream {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        self.recv.poll_read_buf(cx, buf).map_err(|e| match e {
            ReadError::ConnectionLost(c) => c.into(), // idle timeout → TimedOut
            e => e.into(),
        })
    }
}

fn write_err(e: WriteError) -> io::Error {
    match e {
        WriteError::ConnectionLost(c) => c.into(),
        e => e.into(),
    }
}

impl AsyncWrite for Stream {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        AsyncWrite::poll_write(Pin::new(&mut self.send), cx, buf).map_err(|e| match e.get_ref().and_then(|i| i.downcast_ref::<WriteError>()) {
            Some(w) => write_err(w.clone()),
            None => e,
        })
    }
    fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
        Poll::Ready(Ok(()))
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let Stream { send, acked, .. } = &mut *self;
        let acked = acked.get_or_insert_with(|| {
            let _ = send.finish();
            Box::pin(send.stopped())
        });
        // stopped by the peer (it read all it wanted) is done too
        Poll::Ready(ready!(acked.as_mut().poll(cx)).map(|_| ()).map_err(|e| write_err(e.into())))
    }
}

/// This device's certificate and key.
pub struct Identity {
    cert: CertificateDer<'static>,
    key: PrivatePkcs8KeyDer<'static>,
}

impl Identity {
    /// The one kept in `dir`, or a new one saved there (missing or unreadable: pairings must be redone).
    /// The certificate is a plain file; the private key goes through `keystore` (Keychain on macOS, DPAPI on
    /// Windows, an owner-only file elsewhere). A plain `identity.key` from earlier versions is moved in once.
    /// Like `open`, but a refused key gives a throwaway identity (kept in memory only, so the real one survives).
    pub fn load_or_create(dir: &Path) -> Self {
        Self::open(dir).unwrap_or_else(|e| {
            journal!("identity key refused ({e}); using a temporary identity");
            Self::generate()
        })
    }

    /// The identity in `dir`, created on first use. `Err`: there is one, but its key store won't hand the key over
    /// (macOS: the keychain prompt was denied, as after the app's signature changes). Nothing is replaced then: a
    /// new identity would end every pairing, and the old key would later come back next to the new certificate.
    pub fn open(dir: &Path) -> io::Result<Self> {
        let cert_path = dir.join("identity.crt");
        if let Ok(cert) = std::fs::read(&cert_path) {
            if let Some(key) = keystore::load(dir)? {
                return Ok(Self { cert: cert.into(), key: key.into() });
            }
        }
        let id = Self::generate();
        let _ = std::fs::create_dir_all(dir);
        if let Err(e) = std::fs::write(&cert_path, &id.cert).and_then(|()| keystore::save(dir, id.key.secret_pkcs8_der())) {
            journal!("saving identity failed: {e}");
        }
        Ok(id)
    }

    pub fn generate() -> Self {
        let c = rcgen::generate_simple_self_signed(vec!["tcuflow".into()]).expect("self-signed certificate");
        Self { cert: c.cert.der().clone(), key: PrivatePkcs8KeyDer::from(c.key_pair.serialize_der()) }
    }

    pub fn fingerprint(&self) -> String {
        fingerprint(&self.cert)
    }
}

/// Where the private key rests. `load` is `None` when there is none (or it can't be read: then a new identity
/// is made and pairings redone, which beats running with a key someone else could have copied).
mod keystore {
    use super::*;
    use std::io;

    const PLAIN: &str = "identity.key";

    /// Pre-keystore installs kept the PKCS#8 key as a plain file: read it once, move it in, delete it.
    fn take_plain(dir: &Path) -> Option<Vec<u8>> {
        let path = dir.join(PLAIN);
        let key = std::fs::read(&path).ok().filter(|k| !k.is_empty())?;
        match save_protected(dir, &key) {
            Ok(()) => {
                let _ = std::fs::remove_file(&path);
                journal!("identity key moved into the {}", STORE);
            }
            Err(e) => journal!("identity key stays a plain file ({STORE}: {e})"),
        }
        Some(key)
    }

    /// `Err`: a key is there but the store refused it, and no plain file stands in.
    pub fn load(dir: &Path) -> io::Result<Option<Vec<u8>>> {
        match load_protected(dir) {
            Ok(Some(key)) => Ok(Some(key)),
            Ok(None) => Ok(take_plain(dir)),
            // the plain file is where the key went when the store refused saving it
            Err(e) => take_plain(dir).map(Some).ok_or(e),
        }
    }

    pub fn save(dir: &Path, key: &[u8]) -> io::Result<()> {
        save_protected(dir, key).or_else(|e| {
            journal!("{STORE} refused the identity key ({e}); keeping it as an owner-only file");
            write_owner_only(&dir.join(PLAIN), key)
        })
    }

    /// A file only this user can read (0600; Windows ACLs already scope the profile to the user).
    fn write_owner_only(path: &Path, bytes: &[u8]) -> io::Result<()> {
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
            f.write_all(bytes)
        }
        #[cfg(not(unix))]
        std::fs::write(path, bytes)
    }

    #[cfg(target_os = "macos")]
    const STORE: &str = "login keychain";
    #[cfg(target_os = "macos")]
    const SERVICE: &str = "dev.tcuflow.app identity";

    /// One keychain item per data directory (tests and the simulator use their own), as a generic password
    /// owned by this app: macOS asks the user before another app may read it.
    /// Absent, or no keychain to ask (a session without one): `None`, and the plain file is the store. Anything
    /// else — a denied prompt above all — is an error, since the key is there.
    #[cfg(target_os = "macos")]
    fn load_protected(dir: &Path) -> io::Result<Option<Vec<u8>>> {
        const ABSENT: [i32; 3] = [-25300, -25291, -25294]; // errSecItemNotFound, errSecNotAvailable, errSecNoSuchKeychain
        match security_framework::passwords::get_generic_password(SERVICE, &dir.to_string_lossy()) {
            Ok(key) => Ok(Some(key).filter(|k| !k.is_empty())),
            Err(e) if ABSENT.contains(&e.code()) => Ok(None),
            Err(e) => Err(io::Error::other(e)),
        }
    }
    #[cfg(target_os = "macos")]
    fn save_protected(dir: &Path, key: &[u8]) -> io::Result<()> {
        security_framework::passwords::set_generic_password(SERVICE, &dir.to_string_lossy(), key).map_err(io::Error::other)
    }
    #[cfg(all(target_os = "macos", test))]
    pub fn forget(dir: &Path) {
        let _ = security_framework::passwords::delete_generic_password(SERVICE, &dir.to_string_lossy());
    }

    #[cfg(target_os = "windows")]
    const STORE: &str = "Windows data protection";
    /// The key file holds a DPAPI blob (user scope: only this Windows account on this machine decrypts it)
    /// behind a marker that tells it from the old plain PKCS#8.
    #[cfg(target_os = "windows")]
    const MARK: &[u8] = b"TCuFlow-DPAPI-1\n";
    #[cfg(target_os = "windows")]
    const PROTECTED: &str = "identity.key.dpapi";

    #[cfg(target_os = "windows")]
    fn dpapi(input: &[u8], protect: bool) -> io::Result<Vec<u8>> {
        use windows::Win32::Foundation::{LocalFree, HLOCAL};
        use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
        let blob = CRYPT_INTEGER_BLOB { cbData: input.len() as u32, pbData: input.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: `blob` points at `input` for the call; `out` is freed with LocalFree as the API requires
        let r = unsafe {
            if protect {
                CryptProtectData(&blob, windows::core::w!("TCuFlow identity"), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&blob, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            }
        };
        r.map_err(io::Error::other)?;
        let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize) }.to_vec();
        unsafe { LocalFree(Some(HLOCAL(out.pbData.cast()))) };
        Ok(bytes)
    }
    /// A blob this account can't unprotect (a profile copied from another PC) never will be: `None`, start over.
    #[cfg(target_os = "windows")]
    fn load_protected(dir: &Path) -> io::Result<Option<Vec<u8>>> {
        let Ok(file) = std::fs::read(dir.join(PROTECTED)) else { return Ok(None) };
        let Some(blob) = file.strip_prefix(MARK) else { return Ok(None) };
        Ok(dpapi(blob, false).inspect_err(|e| journal!("identity key can't be unprotected: {e}")).ok())
    }
    #[cfg(target_os = "windows")]
    fn save_protected(dir: &Path, key: &[u8]) -> io::Result<()> {
        let mut file = MARK.to_vec();
        file.extend(dpapi(key, true)?);
        std::fs::write(dir.join(PROTECTED), file)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    const STORE: &str = "owner-only file";
    /// Linux, Android, iOS: the file itself, readable by this user only (Android and iOS sandbox the app's
    /// data directory per app already).
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn load_protected(dir: &Path) -> io::Result<Option<Vec<u8>>> {
        Ok(std::fs::read(dir.join(PLAIN)).ok().filter(|k| !k.is_empty()))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn save_protected(dir: &Path, key: &[u8]) -> io::Result<()> {
        write_owner_only(&dir.join(PLAIN), key)
    }
}

/// Hex SHA-256 of a certificate.
pub fn fingerprint(cert: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, cert).as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// The code both screens show while `requester` pairs with `answerer`, from both fingerprints and both
/// pairing nonces: "123 456".
pub fn pairing_code(requester: &str, answerer: &str, n_requester: &[u8; 32], n_answerer: &[u8; 32]) -> String {
    let mut c = ring::digest::Context::new(&ring::digest::SHA256);
    for part in [requester.as_bytes(), answerer.as_bytes(), n_requester, n_answerer] {
        c.update(part);
    }
    let n = u32::from_be_bytes(c.finish().as_ref()[..4].try_into().unwrap()) % 1_000_000;
    format!("{:03} {:03}", n / 1000, n % 1000)
}

/// A fresh pairing nonce.
pub fn nonce() -> [u8; 32] {
    let mut n = [0; 32];
    ring::rand::SystemRandom::new().fill(&mut n).expect("system random");
    n
}

/// The requester's commitment to its nonce, sent before it sees the other side's.
pub fn commit(nonce: &[u8; 32]) -> [u8; 32] {
    ring::digest::digest(&ring::digest::SHA256, nonce).as_ref().try_into().unwrap()
}

/// Accepts any certificate during the handshake (signatures are still checked, so the peer proves it
/// holds the key); who it is gets decided by its fingerprint afterwards.
#[derive(Debug)]
struct ByFingerprint(Arc<CryptoProvider>);

impl ServerCertVerifier for ByFingerprint {
    fn verify_server_cert(&self, _: &CertificateDer, _: &[CertificateDer], _: &ServerName, _: &[u8], _: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

impl ClientCertVerifier for ByFingerprint {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &[]
    }
    fn verify_client_cert(&self, _: &CertificateDer, _: &[CertificateDer], _: UnixTime) -> Result<ClientCertVerified, rustls::Error> {
        Ok(ClientCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer, d: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(m, c, d, &self.0.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Both ends of every link, for one identity.
pub struct Tls {
    pub me: String,
    client: ClientConfig,
    server: ServerConfig,
    /// made on first connect: `new` may run outside the async runtime
    endpoint: Mutex<Option<Endpoint>>,
    /// one connection per remote address (and the fingerprint it proved), reused by every stream to it
    links: Mutex<HashMap<SocketAddr, (Connection, String)>>,
}

/// Fingerprint of the certificate the other end of `c` proved it holds.
fn peer_fp(c: &Connection) -> String {
    let certs = c.peer_identity().and_then(|i| i.downcast::<Vec<CertificateDer<'static>>>().ok());
    certs.and_then(|c| c.first().map(|c| fingerprint(c))).unwrap_or_default()
}

impl Tls {
    pub fn new(id: &Identity) -> Self {
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let verifier = Arc::new(ByFingerprint(provider.clone()));
        let key = || PrivateKeyDer::Pkcs8(id.key.clone_key());
        let mut client = rustls::ClientConfig::builder_with_provider(provider.clone())
            .with_protocol_versions(&[&rustls::version::TLS13])
            .expect("TLS 1.3")
            .dangerous()
            .with_custom_certificate_verifier(verifier.clone())
            .with_client_auth_cert(vec![id.cert.clone()], key())
            .expect("own certificate");
        let mut server = rustls::ServerConfig::builder_with_provider(provider)
            .with_protocol_versions(&[&rustls::version::TLS13])
            .expect("TLS 1.3")
            .with_client_cert_verifier(verifier)
            .with_single_cert(vec![id.cert.clone()], key())
            .expect("own certificate");
        // no resumption: it would skip the certificate we pin
        server.send_tls13_tickets = 0;
        client.alpn_protocols = vec![ALPN.to_vec()];
        server.alpn_protocols = vec![ALPN.to_vec()];
        let mut transport = TransportConfig::default();
        transport.keep_alive_interval(Some(KEEP_ALIVE)).max_idle_timeout(Some(IDLE.try_into().expect("idle timeout")));
        let transport = Arc::new(transport);
        let mut client = ClientConfig::new(Arc::new(QuicClientConfig::try_from(Arc::new(client)).expect("QUIC cipher suite")));
        client.transport_config(transport.clone());
        let mut server = ServerConfig::with_crypto(Arc::new(QuicServerConfig::try_from(Arc::new(server)).expect("QUIC cipher suite")));
        server.transport_config(transport);
        Self { me: id.fingerprint(), client, server, endpoint: Mutex::new(None), links: Mutex::new(HashMap::new()) }
    }

    fn endpoint(&self) -> io::Result<Endpoint> {
        let mut e = self.endpoint.lock().unwrap();
        if let Some(e) = &*e {
            return Ok(e.clone());
        }
        let mut ep = Endpoint::client(([0, 0, 0, 0], 0).into())?;
        ep.set_default_client_config(self.client.clone());
        Ok(e.insert(ep).clone())
    }

    /// The connection to `to` (reused while alive); with `expect`, only if the device there is that
    /// fingerprint. A handshake that never completes fails as `HostUnreachable` (the device was never
    /// reached), unlike `TimedOut` later (it went silent); the wrong device there fails with `WRONG_DEVICE`.
    async fn link(&self, to: SocketAddr, expect: Option<&str>) -> io::Result<(Connection, String)> {
        let cached = self.links.lock().unwrap().get(&to).filter(|(c, fp)| c.close_reason().is_none() && expect.is_none_or(|e| e == fp)).cloned();
        if let Some(link) = cached {
            return Ok(link);
        }
        // a host that never answers fails the handshake after IDLE
        let unreachable = io::ErrorKind::HostUnreachable;
        let conn = self.endpoint()?.connect(to, "tcuflow").map_err(|e| io::Error::new(unreachable, e))?.await.map_err(|e| io::Error::new(unreachable, e))?;
        let fp = peer_fp(&conn);
        if expect.is_some_and(|e| e != fp) {
            conn.close(0u32.into(), b"");
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, WRONG_DEVICE));
        }
        self.links.lock().unwrap().insert(to, (conn.clone(), fp.clone()));
        Ok((conn, fp))
    }

    /// A new stream to `to`; with `expect`, only if the device there is that fingerprint (errors: `link`).
    /// The peer sees the stream once something is written on it.
    pub async fn connect(&self, to: SocketAddr, expect: Option<&str>) -> io::Result<(Stream, String)> {
        let (conn, fp) = self.link(to, expect).await?;
        Ok((Stream::new(conn.open_bi().await?), fp))
    }

    /// Round-trip time to device `expect` at `to`, connecting first if needed (keep-alives keep it fresh).
    pub async fn rtt(&self, to: SocketAddr, expect: &str) -> io::Result<Duration> {
        Ok(self.link(to, Some(expect)).await?.0.rtt())
    }

    /// Accept streams on UDP `port`. Handshakes and each connection's streams are handled in their own
    /// tasks, so a slow peer never holds up the others.
    pub fn listen(&self, port: u16) -> io::Result<Listener> {
        let ep = Endpoint::server(self.server.clone(), ([0, 0, 0, 0], port).into())?;
        let (tx, rx) = mpsc::channel(16);
        tokio::spawn(async move {
            while let Some(incoming) = ep.accept().await {
                let tx = tx.clone();
                tokio::spawn(async move {
                    let Ok(conn) = incoming.await else { return };
                    let fp = peer_fp(&conn);
                    while let Ok(s) = conn.accept_bi().await {
                        if tx.send((Stream::new(s), fp.clone(), conn.remote_address())).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        Ok(Listener(rx))
    }
}

pub struct Listener(mpsc::Receiver<(Stream, String, SocketAddr)>);

impl Listener {
    /// The next stream a device opened: the stream, that device's fingerprint and its address.
    pub async fn accept(&mut self) -> io::Result<(Stream, String, SocketAddr)> {
        self.0.recv().await.ok_or_else(|| io::Error::other("listener stopped"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn both_ends_learn_who_the_other_is_and_impostors_are_refused() {
        let (a, b, c) = (Tls::new(&Identity::generate()), Tls::new(&Identity::generate()), Tls::new(&Identity::generate()));
        let port = 53387;
        let addr: SocketAddr = ([127, 0, 0, 1], port).into();
        let mut listener = b.listen(port).unwrap();
        let (got_tx, mut got) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                let (mut s, who, _) = listener.accept().await.unwrap();
                let got_tx = got_tx.clone();
                tokio::spawn(async move {
                    let mut all = Vec::new();
                    s.read_to_end(&mut all).await.unwrap();
                    let _ = got_tx.send(all.len());
                    // the connecting side may be gone already (last case below)
                    let _ = s.write_all(who.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        let (mut s, fp) = a.connect(addr, Some(&b.me)).await.unwrap();
        assert_eq!(fp, b.me);
        s.write_all(b"hi").await.unwrap();
        s.shutdown().await.unwrap();
        let mut seen = String::new();
        s.read_to_string(&mut seen).await.unwrap();
        assert_eq!(seen, a.me, "the server sees the client's own certificate");

        // the next stream rides the same connection
        let id = a.links.lock().unwrap()[&addr].0.stable_id();
        let (mut s, _) = a.connect(addr, Some(&b.me)).await.unwrap();
        s.write_all(b"again").await.unwrap();
        s.shutdown().await.unwrap();
        assert_eq!(a.links.lock().unwrap()[&addr].0.stable_id(), id);
        assert_eq!(got.recv().await, Some(2));
        assert_eq!(got.recv().await, Some(5));

        // b is paired as "the device at addr": a connection expecting c there fails
        assert_eq!(a.connect(addr, Some(&c.me)).await.map(|_| ()).unwrap_err().kind(), io::ErrorKind::PermissionDenied);
        // nothing answers there: never reached, not "went silent"
        assert_eq!(a.connect(([127, 0, 0, 1], 53376).into(), None).await.map(|_| ()).unwrap_err().kind(), io::ErrorKind::HostUnreachable);

        // a sender that drops everything (its last connection handle too) right after shutdown loses nothing
        let big = vec![7u8; 3 << 20];
        {
            let d = Tls::new(&Identity::generate());
            let (mut s, _) = d.connect(addr, None).await.unwrap();
            s.write_all(&big).await.unwrap();
            s.shutdown().await.unwrap();
        }
        assert_eq!(got.recv().await, Some(big.len()));
    }

    #[test]
    fn pairing_code_needs_both_nonces_and_knows_who_asked() {
        let (a, b) = (Identity::generate().fingerprint(), Identity::generate().fingerprint());
        let (na, nb) = (nonce(), nonce());
        let code = pairing_code(&a, &b, &na, &nb);
        assert_eq!(code.len(), 7);
        assert_eq!(code, pairing_code(&a, &b, &na, &nb));
        assert_ne!(code, pairing_code(&a, &b, &na, &nonce()));
        assert_ne!(code, pairing_code(&b, &a, &na, &nb));
        assert_eq!(commit(&na), commit(&na));
        assert_ne!(commit(&na), commit(&nb));
    }

    fn forget(dir: &Path) {
        #[cfg(target_os = "macos")]
        keystore::forget(dir);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn identity_survives_restart() {
        let dir = std::env::temp_dir().join(format!("tcuflow-id-{}", uuid::Uuid::new_v4()));
        let first = Identity::load_or_create(&dir).fingerprint();
        assert_eq!(Identity::load_or_create(&dir).fingerprint(), first);
        assert_eq!(first.len(), 64);
        // the private key is not lying around as plain PKCS#8 where the OS has a store for it
        if cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(!dir.join("identity.key").exists(), "plain key file left behind");
        }
        forget(&dir);
    }

    #[test]
    fn plain_key_from_an_older_version_is_moved_into_the_store() {
        let dir = std::env::temp_dir().join(format!("tcuflow-id-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = Identity::generate();
        std::fs::write(dir.join("identity.crt"), &old.cert).unwrap();
        std::fs::write(dir.join("identity.key"), old.key.secret_pkcs8_der()).unwrap();
        let loaded = Identity::load_or_create(&dir);
        assert_eq!(loaded.fingerprint(), old.fingerprint(), "same identity after the move");
        assert_eq!(loaded.key.secret_pkcs8_der(), old.key.secret_pkcs8_der());
        if cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(!dir.join("identity.key").exists(), "plain key file should be gone after migration");
        }
        assert_eq!(Identity::load_or_create(&dir).fingerprint(), old.fingerprint(), "and it stays");
        forget(&dir);
    }
}
