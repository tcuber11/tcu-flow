# App Store listing (iOS / iPadOS)

Paste into App Store Connect → TCuFlow → Distribution. Limits in brackets; every field below fits.

## App Information

- **Name** [30]: `TCuFlow`
- **Subtitle** [30]: `Touchpad for your Mac and PC`
- **Category**: Utilities; secondary: Productivity
- **Content rights**: no third-party content
- **Age rating**: answer *None* to every question → 4+

## Version page

**Promotional text** [170]:

```
Turn your iPhone or iPad into a touchpad and keyboard for the computers on your desk. Copy on one, paste on another. Free, no account, nothing leaves your Wi-Fi.
```

**Description** [4000]:

```
TCuFlow turns your iPhone or iPad into a touchpad and keyboard for your Mac, Windows PC or Linux computer, over your own Wi-Fi.

Open it next to a computer running TCuFlow, pair once by checking that both screens show the same 6-digit code, and you're in control:

• Touchpad: one finger moves the cursor, two fingers scroll, tap to click, with left and right buttons.
• Keyboard: type on the computer from your phone.
• Screen: see the computer's screen on your phone or iPad and work on it directly: tap to click, pinch to zoom, in portrait or landscape.
• Clipboard: copy text on one device and paste it on the other.
• Files: send photos and files from your phone to the computer.

Private by design
• No account, no cloud, no ads, no tracking. TCuFlow collects no data.
• Your devices talk to each other directly on your local network, encrypted with TLS 1.3.
• Only devices you paired yourself can connect.

On the computer, TCuFlow also shares one mouse and keyboard between a Mac and a PC: push the cursor through the edge of one screen and it lands on the other. It's free and open source: https://tcuber11.github.io/tcu-flow/

Needs TCuFlow on the computer (free for macOS, Windows and Linux) and both devices on the same network. If your computer isn't listed, add it by its IP address.
```

**Keywords** [100]: `touchpad,trackpad,remote mouse,keyboard,clipboard,file transfer,mac,windows,pc,kvm,wifi mouse`

**Support URL**: `https://github.com/tcuber11/tcu-flow/issues`
**Marketing URL**: `https://tcuber11.github.io/tcu-flow/`
**Copyright**: `2026 Widyo Tri Cahya Utomo`

**Screenshots** (this folder, from `node scripts/appstore-screenshots.mjs`):

- iPhone 6.9" display: `iphone-1-computers.png`, `iphone-2-touchpad.png`, `iphone-3-pair.png`
- iPad 13" display: `ipad-1-computers.png`, `ipad-2-touchpad.png`, `ipad-3-pair.png`

## App Privacy

- **Privacy Policy URL**: `https://tcuber11.github.io/tcu-flow/privacy.html`
- **Data collection**: *No, we do not collect data from this app* → label "Data Not Collected".

## Pricing and Availability

Free. **Remove France** from the countries: the export compliance answer says the app isn't distributed there (France needs its own encryption declaration).

## App Review Information

Sign-in required: no. Notes for the reviewer:

```
TCuFlow is the iPhone/iPad companion of a desktop app: it controls a computer running TCuFlow on the same Wi-Fi.

To test:
1. On a Mac, install TCuFlow from https://tcuber11.github.io/tcu-flow/ (free, Developer ID signed and notarized) and open it.
2. Open TCuFlow on the iPhone or iPad on the same Wi-Fi and allow Local Network access. The Mac appears under "Nearby, not paired" (or type the Mac's IP address, shown in the Mac app, under "Add by IP").
3. Tap Pair; both screens show the same 6-digit code; accept on the Mac.
4. Tap "Use as touchpad" and move the Mac's cursor; use Keyboard to type; use "Send files" to send a photo.
5. To see the Mac's screen: on the Mac turn on "Its screen" under "This computer shares" (macOS asks for Screen Recording once), then tap "View screen" on the iPhone or iPad.

The app collects no data and has no account. All traffic stays on the local network, encrypted with TLS 1.3.
```

---

## Bahasa Indonesia (opsional: tambah lokalisasi Indonesian)

**Subtitle**: `Touchpad untuk Mac dan PC`

**Promotional text**:

```
Jadikan iPhone atau iPad touchpad dan keyboard untuk komputer di mejamu. Salin di satu perangkat, tempel di perangkat lain. Gratis, tanpa akun, semua tetap di Wi-Fi-mu.
```

**Description**:

```
TCuFlow menjadikan iPhone atau iPad sebagai touchpad dan keyboard untuk Mac, PC Windows, atau komputer Linux, lewat Wi-Fi-mu sendiri.

Buka di dekat komputer yang menjalankan TCuFlow, pasangkan sekali dengan mencocokkan kode 6 digit yang sama di kedua layar, lalu kendalikan:

• Touchpad: satu jari menggerakkan kursor, dua jari menggulir, ketuk untuk klik, plus tombol kiri dan kanan.
• Keyboard: mengetik di komputer dari HP.
• Layar: lihat layar komputer di HP atau iPad dan langsung bekerja di sana: ketuk untuk klik, cubit untuk zoom, tegak atau mendatar.
• Clipboard: salin teks di satu perangkat, tempel di perangkat lain.
• File: kirim foto dan file dari HP ke komputer.

Privat sejak awal
• Tanpa akun, tanpa cloud, tanpa iklan, tanpa pelacakan. TCuFlow tidak mengumpulkan data.
• Perangkatmu berbicara langsung di jaringan lokal, terenkripsi TLS 1.3.
• Hanya perangkat yang kamu pasangkan sendiri yang bisa tersambung.

Di komputer, TCuFlow juga berbagi satu mouse dan keyboard antara Mac dan PC: dorong kursor melewati tepi layar dan ia muncul di komputer sebelah. Gratis dan open source: https://tcuber11.github.io/tcu-flow/

Butuh TCuFlow di komputer (gratis untuk macOS, Windows, dan Linux) dan kedua perangkat di jaringan yang sama. Kalau komputer tidak muncul, tambahkan lewat alamat IP-nya.
```

**Keywords**: `touchpad,trackpad,mouse,keyboard,clipboard,kirim file,mac,windows,pc,remote,wifi`
